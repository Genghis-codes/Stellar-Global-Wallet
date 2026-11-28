"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { isSubmitPending } from "@/lib/api/endpoints/wallet";
import { queryKeys } from "@/lib/query/keys";
import { useSignAndSubmit, type BuiltTransaction } from "./useSignAndSubmit";

export interface AccountTxOutcome {
  hash: string;
  /** Horizon timed out (202); the transaction may still land. */
  pending: boolean;
}

/** Thrown when the network accepted the envelope but the transaction failed. */
export class TransactionFailedError extends Error {
  constructor(readonly hash: string) {
    super("The network rejected this transaction. No funds were moved.");
    this.name = "TransactionFailedError";
  }
}

/**
 * build (backend) → sign (Freighter) → submit (/wallet/submit) for a
 * transaction sourced from the signed-in account, then refresh everything
 * cached for that account.
 */
export function useAccountTransaction(account: string) {
  const queryClient = useQueryClient();
  const { run, phase, busy } = useSignAndSubmit();

  const execute = useCallback(
    async (build: () => Promise<BuiltTransaction>): Promise<AccountTxOutcome> => {
      const result = await run({ build, submit: (signed) => api.wallet.submit(signed, { account }) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.account.all(account) });
      if (isSubmitPending(result)) return { hash: result.hash, pending: true };
      if (!result.successful) throw new TransactionFailedError(result.hash);
      return { hash: result.hash, pending: false };
    },
    [run, account, queryClient],
  );

  return { execute, phase, busy };
}
