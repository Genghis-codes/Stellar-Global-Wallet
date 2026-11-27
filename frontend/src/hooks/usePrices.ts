"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PriceHistoryRange } from "@/lib/api/endpoints/price";
import { resolveDisplayCurrency } from "@/lib/currency";
import { valuePortfolio, type Holding, type PortfolioValuation } from "@/lib/price/valuation";
import { queryKeys } from "@/lib/query/keys";
import { assetFromBalanceLine, assetId } from "@/lib/stellar/asset";
import { useAccountReserves } from "./useAccount";
import { usePreferences } from "./usePreferences";
import { useFeatureFlags } from "./useServerConfig";

/** Whether the server has a price source (the `priceOracle` flag). */
export function usePricesEnabled(): boolean {
  return useFeatureFlags().data?.priceOracle === true;
}

/** USD quotes for a set of asset ids, only when the price oracle is enabled. */
export function useAssetPrices(assets: string[]) {
  const enabled = usePricesEnabled();
  return useQuery({
    queryKey: queryKeys.price.many(assets),
    queryFn: ({ signal }) => api.price.many(assets, signal),
    enabled: enabled && assets.length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** Historical USD prices for one asset (the backend fills gaps; points may have null prices). */
export function usePriceHistory(asset: string | null, range: PriceHistoryRange) {
  const enabled = usePricesEnabled();
  return useQuery({
    queryKey: queryKeys.price.history(asset ?? "", range),
    queryFn: ({ signal }) => api.price.history(asset!, range, signal),
    enabled: enabled && Boolean(asset),
    staleTime: 5 * 60_000,
  });
}

export interface PortfolioValue {
  /** False when the server has no price source; hide fiat values. */
  enabled: boolean;
  isPending: boolean;
  valuation: PortfolioValuation | null;
  /** Currency values are rendered in. */
  currency: string;
  /** True when the preferred currency can't be shown and USD is used instead. */
  currencyFallback: boolean;
}

/** Fiat valuation of every balance the account holds, in the display currency. */
export function usePortfolioValue(accountId: string | null | undefined): PortfolioValue {
  const enabled = usePricesEnabled();
  const reserves = useAccountReserves(accountId);
  const preferences = usePreferences();
  const holdings = useMemo<Holding[]>(
    () =>
      (reserves.data?.balances ?? []).flatMap((line) => {
        const asset = assetFromBalanceLine(line);
        return asset ? [{ asset: assetId(asset), amount: line.balance }] : [];
      }),
    [reserves.data]
  );
  const prices = useAssetPrices(holdings.map((h) => h.asset));
  const { code, fallback } = resolveDisplayCurrency(preferences.data?.currency);
  const valuation = useMemo(
    () => (prices.data ? valuePortfolio(holdings, prices.data) : null),
    [holdings, prices.data]
  );

  return {
    enabled,
    isPending: enabled && (reserves.isPending || prices.isPending),
    valuation,
    currency: code,
    currencyFallback: fallback,
  };
}
