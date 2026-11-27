"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MultisigInfo } from "@/lib/api/endpoints/account";
import { isSubmitPending, type SetOptionsInput } from "@/lib/api/endpoints/multisig";
import type { PendingTx } from "@/lib/api/endpoints/pendingTxs";
import { queryKeys } from "@/lib/query/keys";
import { useSignAndSubmit, type TxPhase } from "@/hooks/useSignAndSubmit";

export type SignerChangeOutcome =
  | { kind: "submitted"; hash: string; pending: boolean }
  | { kind: "shared"; pendingTx: PendingTx };

/** Toast for a finished change. */
export function outcomeToast(outcome: SignerChangeOutcome) {
  return outcome.kind === "shared"
    ? {
        title: "Shared for co-signing",
        description: "The other signers can now sign it under Security → Pending.",
        tone: "info" as const,
      }
    : { title: outcome.pending ? "Submitted, waiting for the network" : "Signers updated", tone: "success" as const };
}

/** Whether the signed-in key alone meets the high threshold that set-options needs. */
export function canSignAlone(info: MultisigInfo, account: string): boolean {
  const own = info.signers.find((signer) => signer.key === account)?.weight ?? 0;
  return own > 0 && own >= info.thresholds.high;
}

/**
 * Build a set-options change on the server, sign it in the wallet, then
 * either submit it (the user's key meets the high threshold alone) or share
 * it on /pending-txs for the other signers to co-sign.
 */
export function useSignerChange(info: MultisigInfo, account: string) {
  const queryClient = useQueryClient();
  const { sign } = useSignAndSubmit();
  const [phase, setPhase] = useState<TxPhase>("idle");

  async function apply(change: Omit<SetOptionsInput, "sourcePublicKey">): Promise<SignerChangeOutcome> {
    try {
      setPhase("building");
      const built = await api.multisig.buildSetOptions({ sourcePublicKey: account, ...change });
      setPhase("signing");
      const signed = await sign(built.xdr, built.networkPassphrase);
      setPhase("submitting");
      if (!canSignAlone(info, account)) {
        const pendingTx = await api.pendingTxs.create(signed);
        void queryClient.invalidateQueries({ queryKey: queryKeys.pendingTxs.all(account) });
        return { kind: "shared", pendingTx };
      }
      const result = await api.multisig.submit(signed);
      void queryClient.invalidateQueries({ queryKey: queryKeys.account.all(account) });
      return { kind: "submitted", hash: result.hash, pending: isSubmitPending(result) };
    } finally {
      setPhase("idle");
    }
  }

  return { apply, phase, busy: phase !== "idle" };
}
