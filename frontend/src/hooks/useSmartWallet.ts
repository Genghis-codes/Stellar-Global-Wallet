"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query/keys";

/**
 * React Query hooks for the globe-wallet smart-wallet contract
 * (/api/v1/contract). Contract reads go through a short simulate cache on
 * the backend, so a 15 s stale time is enough.
 */

const CONTRACT_STALE_MS = 15_000;

export function useContractStatus() {
  return useQuery({
    queryKey: queryKeys.contract.status(),
    queryFn: ({ signal }) => api.contract.status(signal),
    staleTime: CONTRACT_STALE_MS,
  });
}

export function useContractAdmin() {
  return useQuery({
    queryKey: queryKeys.contract.admin(),
    queryFn: ({ signal }) => api.contract.admin(signal),
    staleTime: CONTRACT_STALE_MS,
  });
}

/** Guardians, recovery config and the active proposal; polls while a proposal is open. */
export function useRecoveryState() {
  return useQuery({
    queryKey: queryKeys.contract.recovery(),
    queryFn: ({ signal }) => api.contract.recovery(signal),
    staleTime: CONTRACT_STALE_MS,
    refetchInterval: (query) => (query.state.data?.proposal ? 30_000 : false),
  });
}

/** Assets on the account's wallet whitelist. */
export function useContractAssets(accountId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.contract.assets(accountId ?? ""),
    queryFn: ({ signal }) => api.contract.assets(accountId!, signal),
    enabled: Boolean(accountId),
    staleTime: CONTRACT_STALE_MS,
  });
}

/** Limit, spent and remaining per whitelisted asset. */
export function useSpendAllowances(accountId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.contract.allowances(accountId ?? ""),
    queryFn: ({ signal }) => api.contract.spendAllowances(accountId!, signal),
    enabled: Boolean(accountId),
    staleTime: CONTRACT_STALE_MS,
  });
}
