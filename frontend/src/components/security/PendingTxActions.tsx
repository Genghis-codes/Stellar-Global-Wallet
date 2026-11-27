"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { isSubmitPending } from "@/lib/api/endpoints/multisig";
import type { PendingTx } from "@/lib/api/endpoints/pendingTxs";
import { queryKeys } from "@/lib/query/keys";
import { hasSigned, isOpen } from "@/lib/multisig/pendingTx";
import { networkPassphrase } from "@/lib/stellar/network";
import { useAddSignatures, useCancelPendingTx } from "@/hooks/usePendingTxs";
import { phaseLabel, useSignAndSubmit, useTxErrorToast, type TxPhase } from "@/hooks/useSignAndSubmit";

export interface PendingTxActionsProps {
  tx: PendingTx;
  account: string;
  /** Reports whether an action is running (to lock the dialog). */
  onBusyChange?: (busy: boolean) => void;
}

/** Co-sign / submit / cancel for one pending transaction. */
export function PendingTxActions({ tx, account, onBusyChange }: PendingTxActionsProps) {
  const toast = useToast();
  const toastError = useTxErrorToast();
  const { sign } = useSignAndSubmit();
  const addSignatures = useAddSignatures(account);
  const cancelTx = useCancelPendingTx(account);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [signPhase, setSignPhase] = useState<TxPhase>("idle");
  const [submitPhase, setSubmitPhase] = useState<TxPhase>("idle");
  const queryClient = useQueryClient();

  function track<T>(setPhase: (phase: TxPhase) => void, work: () => Promise<T>) {
    onBusyChange?.(true);
    return work().finally(() => {
      setPhase("idle");
      onBusyChange?.(false);
    });
  }

  async function coSign() {
    await track(setSignPhase, async () => {
      try {
        setSignPhase("signing");
        const signed = await sign(tx.xdr, networkPassphrase());
        setSignPhase("submitting");
        const updated = await addSignatures.mutateAsync({ id: tx.id, xdr: signed });
        toast.show(
          updated.status === "ready"
            ? { title: "Signed: ready to submit", tone: "success" }
            : {
                title: "Signature added",
                description: `Weight ${updated.collectedWeight} of ${updated.requiredWeight}.`,
                tone: "success",
              },
        );
      } catch (error) {
        toastError(error, "Couldn't add your signature");
      }
    });
  }

  /**
   * Submit the collected envelope. POST /wallet/submit-multisig takes secret
   * keys, so the non-custodial /wallet/submit is used: it only accepts
   * envelopes whose source is the signed-in account.
   */
  async function submit() {
    await track(setSubmitPhase, async () => {
      try {
        setSubmitPhase("submitting");
        const result = await api.multisig.submit(tx.xdr, `pending-tx:${tx.id}`);
        void queryClient.invalidateQueries({ queryKey: queryKeys.account.all(account) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.pendingTxs.all(account) });
        toast.show(
          isSubmitPending(result)
            ? { title: "Submitted", description: "The network hasn't confirmed it yet.", tone: "info" }
            : result.successful
              ? { title: "Transaction submitted", tone: "success" }
              : { title: "The network rejected the transaction", tone: "danger" },
        );
      } catch (error) {
        toastError(error, "Couldn't submit the transaction");
      }
    });
  }

  async function cancel() {
    onBusyChange?.(true);
    try {
      await cancelTx.mutateAsync(tx.id);
      toast.show({ title: "Transaction cancelled", tone: "info" });
    } catch (error) {
      toastError(error, "Couldn't cancel the transaction");
    } finally {
      setConfirmCancel(false);
      onBusyChange?.(false);
    }
  }

  const open = isOpen(tx);
  const signed = hasSigned(tx, account);

  return (
    <>
      {open && tx.createdBy === account && (
        confirmCancel ? (
          <>
            <span className="self-center text-sm text-fg">Cancel for every signer?</span>
            <Button variant="secondary" onClick={() => setConfirmCancel(false)} disabled={cancelTx.isPending}>
              Keep
            </Button>
            <Button variant="danger" onClick={() => void cancel()} loading={cancelTx.isPending}>
              Yes, cancel
            </Button>
          </>
        ) : (
          <Button variant="ghost" className="mr-auto" onClick={() => setConfirmCancel(true)}>
            Cancel transaction
          </Button>
        )
      )}
      {open && signed && <span className="mr-auto self-center text-sm text-fg-muted">You signed this.</span>}
      {open && !signed && (
        <Button onClick={() => void coSign()} loading={signPhase !== "idle"}>
          {phaseLabel(signPhase, "Co-sign")}
        </Button>
      )}
      {tx.status === "ready" &&
        (tx.account === account ? (
          <Button onClick={() => void submit()} loading={submitPhase !== "idle"}>
            {phaseLabel(submitPhase, "Submit")}
          </Button>
        ) : (
          <span className="self-center text-sm text-fg-muted">Enough signatures: the account owner can submit it.</span>
        ))}
    </>
  );
}
