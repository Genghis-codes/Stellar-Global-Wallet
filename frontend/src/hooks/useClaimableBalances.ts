"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ClaimableBalance } from "@/lib/api/endpoints/account";
import { queryKeys } from "@/lib/query/keys";

/** Claimable balances where the account is a claimant (first 100, newest first). */
export function useClaimableBalances(accountId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.account.claimable(accountId ?? ""),
    queryFn: async ({ signal }) => (await api.account.claimableBalances(accountId!, { limit: 100 }, signal)).items,
    enabled: Boolean(accountId),
    refetchInterval: 60_000,
  });
}

export type ClaimableState = "claimable" | "upcoming" | "expired";

/** Where a balance stands for this account right now. */
export function claimableState(balance: ClaimableBalance, now: Date = new Date()): ClaimableState {
  if (balance.claimableNow) return "claimable";
  if (balance.claimableAfter && new Date(balance.claimableAfter).getTime() > now.getTime()) return "upcoming";
  return "expired";
}

/** The account created (sponsors) this balance, so it may reclaim it once claimants can't. */
export function canReclaim(balance: ClaimableBalance, account: string): boolean {
  return balance.sponsor === account && balance.claimants.some((c) => c.destination === account);
}

/** Balances the account can claim now. */
export function pendingClaimables(balances: ClaimableBalance[] | undefined, account: string): ClaimableBalance[] {
  return (balances ?? []).filter((b) => b.claimableNow && b.claimants.some((c) => c.destination === account) && b.sponsor !== account);
}
