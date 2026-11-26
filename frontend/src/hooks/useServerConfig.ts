"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query/keys";

/** Feature flags from GET /api/v1/flags (gate UI that depends on optional backend features). */
export function useFeatureFlags() {
  return useQuery({
    queryKey: queryKeys.config.flags(),
    queryFn: ({ signal }) => api.config.flags(signal),
    staleTime: 5 * 60_000,
  });
}

/** Network identity from GET /api/v1/network/info. */
export function useNetworkInfo() {
  return useQuery({
    queryKey: queryKeys.config.networkInfo(),
    queryFn: ({ signal }) => api.config.networkInfo(signal),
    staleTime: 10 * 60_000,
  });
}

/** Low/normal/high fee tiers from GET /api/v1/network/fees. */
export function useNetworkFees() {
  return useQuery({
    queryKey: queryKeys.config.fees(),
    queryFn: ({ signal }) => api.config.fees(signal),
    staleTime: 5_000,
  });
}
