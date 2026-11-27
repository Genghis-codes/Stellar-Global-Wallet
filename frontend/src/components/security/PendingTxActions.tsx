"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { PendingTx } from "@/lib/api/endpoints/pendingTxs";
import { hasSigned, isOpen } from "@/lib/multisig/pendingTx";
import { networkPassphrase } from "@/lib/stellar/network";
import { useAddSignatures } from "@/hooks/usePendingTxs";
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
  const [signPhase, setSignPhase] = useState<TxPhase>("idle");

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

  const open = isOpen(tx);
  const signed = hasSigned(tx, account);

  return (
    <>
      {open && signed && <span className="mr-auto self-center text-sm text-fg-muted">You signed this.</span>}
      {open && !signed && (
        <Button onClick={() => void coSign()} loading={signPhase !== "idle"}>
          {phaseLabel(signPhase, "Co-sign")}
        </Button>
      )}
    </>
  );
}
