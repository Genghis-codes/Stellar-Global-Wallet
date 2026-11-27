"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query/keys";
import { classifyRecipient } from "@/lib/stellar/recipient";

/**
 * Resolve a federation (name*domain) or muxed (M...) recipient through
 * GET /api/v1/resolve. Plain G... accounts and invalid input never hit the
 * network.
 */
export function useResolveAddress(address: string) {
  const value = address.trim();
  const kind = classifyRecipient(value);
  return useQuery({
    queryKey: queryKeys.resolve.address(value),
    queryFn: ({ signal }) => api.resolve.resolve(value, signal),
    enabled: kind === "federation" || kind === "muxed",
    staleTime: 5 * 60_000,
    retry: false,
  });
}
