"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { isUnfundedAccountError, useAccountReserves, useCurrentAccount } from "@/hooks/useAccount";
import { useNetworkFees } from "@/hooks/useServerConfig";
import { newIdempotencyKey, useWalletSubmit, type WalletSubmitOutput } from "@/hooks/useWalletSubmit";
import { api } from "@/lib/api";
import { describeError, isApiError } from "@/lib/api/errors";
import type { PaymentBuild, SendPrecheckResult } from "@/lib/api/endpoints/wallet";
import { isSubmitPending } from "@/lib/api/endpoints/wallet";
import { formatAmount, truncateAddress } from "@/lib/format";
import { fromStroops, toStroops } from "@/lib/stellar/amount";
import { validateMemo } from "@/lib/stellar/memo";
import { amountError, maxSendable } from "@/lib/stellar/sendable";
import { assetOptions } from "./AssetPicker";
import { FeeBumpAction, LOW_FEE_CODES } from "./FeeBumpAction";
import { SendForm, type SendFormErrors, type SendFormValues } from "./SendForm";
import { SendReview } from "./SendReview";
import { TxResult } from "./TxResult";
import { describeTxError } from "./txErrors";
import { useRecipient } from "./useRecipient";

export interface SendViewProps {
  /** Pre-filled values, e.g. from a payment request link. */
  initial?: Partial<Pick<SendFormValues, "to" | "amount" | "assetId" | "memo">>;
}

interface Review {
  precheck: SendPrecheckResult;
  build: PaymentBuild | null;
  idempotencyKey: string;
}

type Step =
  | { name: "form" }
  | { name: "review"; review: Review }
  | { name: "result"; output?: WalletSubmitOutput; error?: string; lowFee?: boolean };

const STEP_LABELS: Record<Step["name"], string> = {
  form: "Payment details",
  review: "Review payment",
  result: "Payment result",
};

/** Fallback per-operation fee (stroops) until /network/fees answers. */
const BASE_FEE = "100";

export function SendView({ initial }: SendViewProps) {
  const account = useCurrentAccount();
  const router = useRouter();
  const toast = useToast();
  const reserves = useAccountReserves(account);
  const fees = useNetworkFees();
  const signAndSubmit = useWalletSubmit();

  const [values, setValues] = useState<SendFormValues>({
    to: initial?.to ?? "",
    assetId: initial?.assetId ?? "XLM",
    amount: initial?.amount ?? "",
    memo: initial?.memo ?? "",
    fee: "normal",
  });
  const [showErrors, setShowErrors] = useState(false);
  const [step, setStep] = useState<Step>({ name: "form" });
  // The last signed envelope, so a stuck or under-priced send can be fee-bumped.
  const [signed, setSigned] = useState<{ xdr: string; networkPassphrase: string } | null>(null);
  const recipient = useRecipient(values.to);

  // Move focus to the new step so keyboard and screen-reader users land on it
  // (not on the page top or a button that no longer exists).
  const stepRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    stepRef.current?.focus();
  }, [step.name]);

  const assets = assetOptions(reserves.data?.balances ?? []);
  const selected = assets.find((option) => option.id === values.assetId);
  const perOpFee = fees.data?.[values.fee].stroops ?? BASE_FEE;
  const maxAmount = selected ? maxSendable(selected.spendable, !selected.asset.issuer, perOpFee) : "0";
  const reserve = reserves.data
    ? fromStroops(toStroops(reserves.data.reserves.minimumBalance) + BigInt(perOpFee))
    : undefined;

  const federationMemo = recipient.recipient?.memo;
  const memo = federationMemo?.type === "text" ? federationMemo.value : values.memo;
  const errors: SendFormErrors = {
    to: values.to.trim() === "" ? "Enter a recipient." : null,
    amount: amountError(values.amount, { max: maxAmount, assetCode: selected?.asset.code }),
    memo: validateMemo("text", memo),
    form:
      federationMemo && federationMemo.type !== "text"
        ? `This recipient asks for a ${federationMemo.type === "id" ? "memo ID" : "memo hash"} (${federationMemo.value}). GlobeWallet can only attach text memos, so this payment can't be sent safely from here.`
        : values.assetId !== "XLM" && !selected && reserves.data
          ? "You don't hold this asset. Add a trustline before sending it."
          : null,
  };
  const valid = Boolean(recipient.recipient) && !errors.to && !errors.amount && !errors.memo && !errors.form;

  const prepare = useMutation({
    mutationFn: async (): Promise<Review> => {
      const to = recipient.recipient!;
      const asset = values.assetId;
      const amount = values.amount.trim();
      const precheck = await api.wallet.precheck({
        sourcePublicKey: account,
        destinationPublicKey: to.accountId,
        amount,
        asset,
        memo: memo || undefined,
      });
      const build = precheck.blocking
        ? null
        : await api.wallet.buildSend({
            sourcePublicKey: account,
            destinationPublicKey: to.destination,
            amount,
            asset,
            memo: memo || undefined,
          });
      return { precheck, build, idempotencyKey: newIdempotencyKey() };
    },
    onSuccess: (review) => setStep({ name: "review", review }),
    onError: (error) => toast.show({ title: "Couldn't prepare the payment", description: describeError(error), tone: "danger" }),
  });

  function onSubmit() {
    setShowErrors(true);
    if (valid) prepare.mutate();
  }

  function confirm(review: Review) {
    if (!review.build) return;
    signAndSubmit.mutate(
      {
        xdr: review.build.xdr,
        networkPassphrase: review.build.networkPassphrase,
        perOperationFee: perOpFee,
        idempotencyKey: review.idempotencyKey,
        onSigned: (xdr) => setSigned({ xdr, networkPassphrase: review.build!.networkPassphrase }),
      },
      {
        onSuccess: (output) => setStep({ name: "result", output }),
        onError: (error) => {
          const message = describeTxError(error);
          // Declined in the wallet: stay on the review step.
          if (message) {
            setStep({ name: "result", error: message, lowFee: isApiError(error) && LOW_FEE_CODES.has(error.code) });
          }
        },
      },
    );
  }

  function reset() {
    setValues((current) => ({ ...current, to: "", amount: "", memo: "" }));
    setShowErrors(false);
    signAndSubmit.reset();
    setSigned(null);
    setStep({ name: "form" });
  }

  const header = <PageHeader title="Send" description="Send XLM or any asset you hold to a Stellar address." />;

  if (reserves.isPending) {
    return (
      <>
        {header}
        <Skeleton className="h-96 rounded-[var(--radius-card)]" aria-label="Loading balances" />
      </>
    );
  }
  if (reserves.isError) {
    return (
      <>
        {header}
        {isUnfundedAccountError(reserves.error) ? (
          <EmptyState
            title="Your account isn't funded yet"
            description="A Stellar account needs at least 1 XLM before it can send payments."
            action={<Button onClick={() => router.push("/dashboard")}>Go to dashboard</Button>}
          />
        ) : (
          <EmptyState
            title="Couldn't load your balances"
            description={describeError(reserves.error)}
            action={<Button onClick={() => void reserves.refetch()}>Try again</Button>}
          />
        )}
      </>
    );
  }

  function speedUp(envelope: { xdr: string; networkPassphrase: string }) {
    return (
      <FeeBumpAction
        signedXdr={envelope.xdr}
        networkPassphrase={envelope.networkPassphrase}
        onSubmitted={(result) => setStep({ name: "result", output: { result, signedXdr: envelope.xdr, submittedXdr: envelope.xdr } })}
      />
    );
  }

  const summary = `${formatAmount(values.amount || "0")} ${selected?.asset.code ?? "XLM"} to ${
    recipient.recipient?.federationAddress ?? truncateAddress(recipient.recipient?.destination ?? values.to, 6, 6)
  }`;

  return (
    <div className="mx-auto w-full max-w-xl">
      {header}
      <div ref={stepRef} tabIndex={-1} role="group" aria-label={STEP_LABELS[step.name]} className="outline-none">
        {step.name === "form" && (
          <SendForm
            values={values}
            onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
            recipient={recipient}
            assets={assets}
            maxAmount={maxAmount}
            reserve={reserve}
            fees={fees.data}
            errors={errors}
            showErrors={showErrors}
            memoRequired={Boolean(federationMemo)}
            memoLocked={federationMemo?.type === "text"}
            self={account}
            submitting={prepare.isPending}
            onSubmit={onSubmit}
          />
        )}
        {step.name === "review" && recipient.recipient && (
          <SendReview
            recipient={recipient.recipient}
            amount={values.amount.trim()}
            assetCode={selected?.asset.code ?? "XLM"}
            memo={memo || undefined}
            feeXlm={formatAmount(fromStroops(feeTotal(step.review.build, perOpFee)))}
            feeBump={Boolean(step.review.build && BigInt(perOpFee) > BigInt(step.review.build.fee))}
            createsAccount={step.review.precheck.operationType === "createAccount"}
            warnings={step.review.precheck.warnings}
            blocking={step.review.precheck.blocking || !step.review.build}
            expiresAt={step.review.build?.expiresAt}
            signing={signAndSubmit.isPending}
            onConfirm={() => confirm(step.review)}
            onBack={() => setStep({ name: "form" })}
          />
        )}
        {step.name === "result" &&
          (step.output ? (
            <TxResult
              status={isSubmitPending(step.output.result) ? "pending" : step.output.result.successful ? "success" : "failed"}
              hash={step.output.result.hash}
              title={isSubmitPending(step.output.result) ? undefined : step.output.result.successful ? "Payment sent" : undefined}
              summary={summary}
              actions={isSubmitPending(step.output.result) && signed ? speedUp(signed) : undefined}
              onDone={reset}
              doneLabel="Send another"
            />
          ) : (
            <TxResult
              status="failed"
              summary={summary}
              error={step.error}
              actions={step.lowFee && signed ? speedUp(signed) : undefined}
              onRetry={() => setStep({ name: "form" })}
            />
          ))}
      </div>
    </div>
  );
}

/** Total fee (stroops) for a one-operation payment: the build's, or a fee bump's when the tier is higher. */
function feeTotal(build: PaymentBuild | null, perOpFee: string): bigint {
  const built = BigInt(build?.fee ?? perOpFee);
  const chosen = BigInt(perOpFee);
  // A fee bump pays for the inner operation plus itself.
  return chosen > built ? chosen * 2n : built;
}
