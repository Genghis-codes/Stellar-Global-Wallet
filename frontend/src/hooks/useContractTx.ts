"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { isSubmitPending, type SubmitPending, type SubmitResult } from "@/lib/api/endpoints/multisig";
import { queryKeys } from "@/lib/query/keys";
import { useSignAndSubmit, type BuiltTransaction } from "./useSignAndSubmit";

/**
 * Run one smart-wallet contract action: build on the server, sign in the
 * wallet, submit through /contract/wallet/submit, then refresh every
 * contract query. Throws if the network rejected the transaction.
 */
export function useContractTx() {
  const queryClient = useQueryClient();
  const { run, phase, busy } = useSignAndSubmit();

  const execute = useCallback(
    async (build: () => Promise<BuiltTransaction>): Promise<SubmitResult | SubmitPending> => {
      const result = await run({ build, submit: (signed) => api.contract.submit(signed) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.contract.all() });
      if (!isSubmitPending(result) && !result.successful) {
        throw new Error("The network rejected the transaction.");
      }
      return result;
    },
    [run, queryClient],
  );

  return { execute, phase, busy };
}
