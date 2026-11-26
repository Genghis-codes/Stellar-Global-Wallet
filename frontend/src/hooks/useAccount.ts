"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/query/keys";
import { useAuth } from "./useAuth";

/** The signed-in account id (throws if used outside a signed-in page). */
export function useCurrentAccount(): string {
  const { account } = useAuth();
  if (!account) throw new Error("useCurrentAccount requires a signed-in session");
  return account;
}

/** Horizon answers 404 for accounts that have never been funded. */
export function isUnfundedAccountError(error: unknown): boolean {
  return isApiError(error) && (error.code === "ACCOUNT_NOT_FOUND" || error.status === 404);
}

/** Reserve breakdown plus every balance line with its spendable amount. */
export function useAccountReserves(accountId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.account.reserves(accountId ?? ""),
    queryFn: ({ signal }) => api.account.reserves(accountId!, signal),
    enabled: Boolean(accountId),
    refetchInterval: 30_000,
  });
}

/** Asset code -> balance map (compact; use reserves for full balance lines). */
export function useAccountBalances(accountId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.account.balances(accountId ?? ""),
    queryFn: async ({ signal }) => (await api.account.balances(accountId!, signal)).balances,
    enabled: Boolean(accountId),
  });
}

export function useAccountSigners(accountId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.account.signers(accountId ?? ""),
    queryFn: ({ signal }) => api.account.signers(accountId!, signal),
    enabled: Boolean(accountId),
  });
}
