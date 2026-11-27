"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { isInFlightStatus, isTransactionHash } from "@/lib/api/endpoints/transactions";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/query/keys";
import { fetchTransactionSignatures } from "@/lib/stellar/horizon";

/** How often to look again for a transaction that hasn't reached Horizon yet. */
export const PENDING_POLL_MS = 3_000;
/** Give up polling after this many misses (~2 minutes; transactions expire well before). */
export const PENDING_MAX_POLLS = 40;

export function isTransactionNotFound(error: unknown): boolean {
  return isApiError(error) && (error.code === "TRANSACTION_NOT_FOUND" || error.status === 404);
}

/**
 * One transaction with decoded operations. A just-submitted transaction can
 * 404 until Horizon ingests its ledger, so a not-found result is polled for
 * a while before it is treated as final.
 */
export function useTransaction(hash: string | null | undefined, account?: string) {
  const valid = Boolean(hash && isTransactionHash(hash));
  return useQuery({
    queryKey: queryKeys.transactions.detail(hash ?? "", account),
    queryFn: ({ signal }) => api.transactions.get(hash!, account, signal),
    enabled: valid,
    staleTime: Infinity,
    refetchInterval: (query) =>
      isTransactionNotFound(query.state.error) && query.state.errorUpdateCount < PENDING_MAX_POLLS ? PENDING_POLL_MS : false,
  });
}

/**
 * Submission status from the backend's tracker, polled while in flight.
 * Deployments without tracking answer 503; the hook then stays quiet.
 */
export function useTransactionStatus(hash: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.transactions.status(hash ?? ""),
    queryFn: ({ signal }) => api.transactions.status(hash!, signal),
    enabled: enabled && Boolean(hash && isTransactionHash(hash)),
    retry: false,
    refetchInterval: (query) => (query.state.data && isInFlightStatus(query.state.data.status) ? PENDING_POLL_MS : false),
  });
}

/** Envelope signatures (from Horizon; the backend detail route omits them). */
export function useTransactionSignatures(hash: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.transactions.signatures(hash ?? ""),
    queryFn: ({ signal }) => fetchTransactionSignatures(hash!, { signal }),
    enabled: enabled && Boolean(hash && isTransactionHash(hash)),
    staleTime: Infinity,
    retry: false,
  });
}
