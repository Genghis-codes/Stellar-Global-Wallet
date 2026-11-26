"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query/keys";

/** Page size for the activity lists (backend max is 100). */
export const ACTIVITY_PAGE_SIZE = 25;

/** Payments feed (payments, path payments, create/merge account), newest first, cursor-paged. */
export function usePaymentsFeed(accountId: string | null | undefined) {
  return useInfiniteQuery({
    queryKey: queryKeys.account.feed(accountId ?? "", "payments"),
    queryFn: ({ pageParam, signal }) =>
      api.account.payments(accountId!, { cursor: pageParam, limit: ACTIVITY_PAGE_SIZE }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore && last.nextCursor ? last.nextCursor : undefined),
    enabled: Boolean(accountId),
  });
}

/** Transaction-level history, newest first. */
export function useTransactionsFeed(accountId: string | null | undefined) {
  return useInfiniteQuery({
    queryKey: queryKeys.account.feed(accountId ?? "", "transactions"),
    queryFn: ({ pageParam, signal }) =>
      api.account.transactions(accountId!, { cursor: pageParam, limit: ACTIVITY_PAGE_SIZE }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore && last.nextCursor ? last.nextCursor : undefined),
    enabled: Boolean(accountId),
  });
}

/** Unified feed: payments, Soroban contract events and claimable balances. */
export function useActivityFeed(accountId: string | null | undefined) {
  return useInfiniteQuery({
    queryKey: queryKeys.account.feed(accountId ?? "", "activity"),
    queryFn: ({ pageParam, signal }) =>
      api.account.activity(accountId!, { cursor: pageParam, limit: ACTIVITY_PAGE_SIZE }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore && last.next ? last.next : undefined),
    enabled: Boolean(accountId),
  });
}
