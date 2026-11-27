"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PendingTx } from "@/lib/api/endpoints/pendingTxs";
import { queryKeys } from "@/lib/query/keys";

/** Open multisig transactions for an account; polls so co-signers see new signatures. */
export function usePendingTxs(accountId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.pendingTxs.list(accountId ?? ""),
    queryFn: ({ signal }) => api.pendingTxs.list(accountId!, signal),
    enabled: Boolean(accountId),
    refetchInterval: 20_000,
  });
}

export function usePendingTx(accountId: string, id: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.pendingTxs.detail(accountId, id ?? ""),
    queryFn: ({ signal }) => api.pendingTxs.get(id!, signal),
    enabled: Boolean(id),
  });
}

/** Store the updated row in the detail cache and refresh the list. */
function useApplyPendingTx(accountId: string) {
  const queryClient = useQueryClient();
  return (tx: PendingTx) => {
    queryClient.setQueryData(queryKeys.pendingTxs.detail(accountId, tx.id), tx);
    void queryClient.invalidateQueries({ queryKey: queryKeys.pendingTxs.list(accountId) });
  };
}

export function useSharePendingTx(accountId: string) {
  const apply = useApplyPendingTx(accountId);
  return useMutation({ mutationFn: (xdr: string) => api.pendingTxs.create(xdr), onSuccess: apply });
}

export function useAddSignatures(accountId: string) {
  const apply = useApplyPendingTx(accountId);
  return useMutation({
    mutationFn: ({ id, xdr }: { id: string; xdr: string }) => api.pendingTxs.addSignatures(id, xdr),
    onSuccess: apply,
  });
}

export function useCancelPendingTx(accountId: string) {
  const apply = useApplyPendingTx(accountId);
  return useMutation({ mutationFn: (id: string) => api.pendingTxs.cancel(id), onSuccess: apply });
}
