"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { AmountDisplay } from "@/components/ui/AmountDisplay";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { useCurrentAccount } from "@/hooks/useAccount";
import { useAccountTransaction } from "@/hooks/useAccountTransaction";
import { useAuth } from "@/hooks/useAuth";
import { phaseLabel, useTxErrorToast } from "@/hooks/useSignAndSubmit";
import { api } from "@/lib/api";
import type { CloseAccountDryRun } from "@/lib/api/endpoints/account";
import { describeError } from "@/lib/api/errors";
import { isAccountId } from "@/lib/stellar/address";
import { describeCloseStep } from "./closeSteps";

/** What the user must type to confirm. */
export const CLOSE_CONFIRMATION = "CLOSE ACCOUNT";

export function destinationError(value: string, account: string): string | null {
  const v = value.trim();
  if (!v) return "Enter the account that receives your funds.";
  if (!isAccountId(v)) return "Enter a valid Stellar account (G...).";
  if (v === account) return "The destination must be a different account.";
  return null;
}

function Preview({ preview }: { preview: CloseAccountDryRun }) {
  return (
    <Card>
      <CardHeader title="What will happen" description={`${preview.operationCount} operations in one transaction`} />
      <CardBody className="flex flex-col gap-4">
        <ol aria-label="Close steps" className="list-decimal space-y-1 pl-5 text-sm text-fg">
          {preview.operations.map((op, i) => (
            <li key={i}>{describeCloseStep(op)}</li>
          ))}
        </ol>
        <p className="text-sm text-fg">
          About <AmountDisplay amount={preview.reserveRecovered} asset="XLM" /> goes to the destination, including{" "}
          <AmountDisplay amount={preview.estimatedReserve} asset="XLM" /> of released reserves.
        </p>
        {!preview.canClose && (
          <div role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            <p className="font-medium">This account can&apos;t be closed yet:</p>
            <ul className="list-disc pl-5">
              {preview.blocking.map((b) => (
                <li key={`${b.code}:${b.message}`}>{b.message}</li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ConfirmClose({ account, destination }: { account: string; destination: string }) {
  const router = useRouter();
  const toast = useToast();
  const errorToast = useTxErrorToast();
  const { signOut } = useAuth();
  const { execute, phase, busy } = useAccountTransaction(account);
  const [typed, setTyped] = useState("");
  const confirmed = typed.trim() === CLOSE_CONFIRMATION;

  async function close() {
    try {
      const outcome = await execute(() => api.account.buildClose(account, destination));
      toast.show({
        title: outcome.pending ? "Close submitted" : "Account closed",
        description: outcome.pending
          ? "The network is still confirming it. Check the destination account shortly."
          : "Your funds were sent to the destination account.",
        tone: "success",
      });
      // The session's account no longer exists.
      await signOut();
      router.push("/");
    } catch (err) {
      errorToast(err, "Couldn't close the account");
    }
  }

  return (
    <Card>
      <CardHeader title="Confirm" description={`Type ${CLOSE_CONFIRMATION} to enable closing. Freighter asks you to sign next.`} />
      <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            label="Confirmation"
            placeholder={CLOSE_CONFIRMATION}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <Button variant="danger" disabled={!confirmed} loading={busy} onClick={() => void close()}>
          {phaseLabel(phase, "Close account")}
        </Button>
      </CardBody>
    </Card>
  );
}

/** Close (merge) the account: preview the sequence, then confirm and sign. */
export function CloseAccountView() {
  const account = useCurrentAccount();
  const [destination, setDestination] = useState("");
  const [touched, setTouched] = useState(false);
  const error = destinationError(destination, account);

  const dryRun = useMutation({ mutationFn: (dest: string) => api.account.closeDryRun(account, dest) });

  function preview(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!error) dryRun.mutate(destination.trim());
  }

  return (
    <>
      <PageHeader title="Close account" description="Move everything to another account and remove this one from the network." />
      <div className="flex flex-col gap-4">
        <div role="note" className="rounded-[var(--radius-card)] border border-danger bg-danger-soft p-4 text-sm text-danger">
          <p className="font-semibold">This can&apos;t be undone.</p>
          <p className="mt-1">
            Closing cancels your offers, sends or converts every balance, removes your trustlines and signers, and merges the
            account into the destination. This address stops existing on the network until someone funds it again. Make sure
            the destination is an account you control and that it accepts every asset you hold.
          </p>
        </div>

        <Card>
          <CardBody>
            <form onSubmit={preview} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Input
                  label="Destination account"
                  placeholder="G..."
                  value={destination}
                  onChange={(e) => {
                    setDestination(e.target.value);
                    dryRun.reset();
                  }}
                  onBlur={() => setTouched(true)}
                  error={touched && error ? error : undefined}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <Button type="submit" variant="secondary" loading={dryRun.isPending}>
                Preview
              </Button>
            </form>
            {dryRun.isError && <p className="mt-3 text-sm text-danger">{describeError(dryRun.error)}</p>}
          </CardBody>
        </Card>

        {dryRun.data && <Preview preview={dryRun.data} />}
        {dryRun.data?.canClose && <ConfirmClose account={account} destination={destination.trim()} />}

        <Link href="/dashboard" className="text-sm font-medium text-primary hover:underline">
          Keep my account
        </Link>
      </div>
    </>
  );
}
