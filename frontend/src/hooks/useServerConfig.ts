"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { HealthDetails } from "@/lib/api/endpoints/config";
import { isApiError } from "@/lib/api/errors";
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

/** Server metadata from GET /api/v1/config (contracts, API version, features). */
export function useAppConfig() {
  return useQuery({
    queryKey: queryKeys.config.app(),
    queryFn: ({ signal }) => api.config.get(signal),
    staleTime: 10 * 60_000,
  });
}

function isHealthDetails(value: unknown): value is HealthDetails {
  return typeof value === "object" && value !== null && "status" in value && "checks" in value;
}

/**
 * Dependency health from GET /api/v1/health/details. The backend answers
 * 503 with the same body when Horizon or Soroban RPC is down, so that body
 * is returned as data (status "down") rather than treated as an error.
 */
export function useHealthDetails() {
  return useQuery({
    queryKey: queryKeys.config.health(),
    queryFn: async ({ signal }) => {
      try {
        return await api.config.healthDetails(signal);
      } catch (error) {
        if (isApiError(error) && error.status === 503 && isHealthDetails(error.details)) return error.details;
        throw error;
      }
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}
