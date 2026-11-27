"use client";

import { useCallback, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AssetSearchQuery, VerifiedAsset } from "@/lib/api/endpoints/assets";
import { queryKeys } from "@/lib/query/keys";
import { usePreferences, useUpdatePreferences } from "./usePreferences";

/** The deployment's verified-asset list (changes only on deploy). */
export function useVerifiedAssets() {
  return useQuery({
    queryKey: queryKeys.assets.verified(),
    queryFn: async ({ signal }) => (await api.assets.verified(signal)).assets,
    staleTime: 60 * 60_000,
  });
}

/** Set of verified "CODE:ISSUER" ids, for badges. */
export function useVerifiedAssetIds(): Set<string> {
  const { data } = useVerifiedAssets();
  return useMemo(() => new Set((data ?? []).map((a: VerifiedAsset) => `${a.code}:${a.issuer}`)), [data]);
}

/**
 * Turn what the user typed into a search query: something with a dot is a
 * home domain, otherwise an asset code. Null when there is nothing to search.
 */
export function toAssetSearchQuery(input: string): AssetSearchQuery | null {
  const value = input.trim();
  if (!value) return null;
  if (value.includes(".")) return { domain: value.toLowerCase() };
  if (!/^[A-Za-z0-9]{1,12}$/.test(value)) return null;
  return { code: value.toUpperCase() };
}

export function useAssetSearch(input: string) {
  const query = toAssetSearchQuery(input);
  return useQuery({
    queryKey: queryKeys.assets.search(query ? JSON.stringify(query) : ""),
    queryFn: ({ signal }) => api.assets.search(query!, signal),
    enabled: query !== null,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

/** stellar.toml display data for one issued asset. */
export function useAssetMetadata(code: string | null | undefined, issuer: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.assets.metadata(code ?? "", issuer ?? ""),
    queryFn: ({ signal }) => api.assets.metadata(code!, issuer!, signal),
    enabled: Boolean(code && issuer),
    staleTime: 60 * 60_000,
  });
}

/** Asset ids hidden from balance lists, stored in preferences, with a toggle. */
export function useHiddenAssets() {
  const preferences = usePreferences();
  const update = useUpdatePreferences();
  const hidden = useMemo(() => preferences.data?.hiddenAssets ?? [], [preferences.data]);

  const toggle = useCallback(
    (id: string) => {
      const next = hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
      update.mutate({ hiddenAssets: next });
    },
    [hidden, update],
  );

  return { hidden, isHidden: (id: string) => hidden.includes(id), toggle, saving: update.isPending, error: update.error };
}
