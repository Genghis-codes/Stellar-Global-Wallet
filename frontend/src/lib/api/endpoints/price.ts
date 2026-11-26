import type { ApiClient } from "../client";

/**
 * /api/v1/price — public USD quotes and history (backend/src/routes/price.ts).
 * Assets are identified as "XLM" or "CODE:ISSUER". The `priceOracle` feature
 * flag says whether the server has a real price source configured.
 */

export type PriceSource = "stellar_dex" | "coingecko" | "consensus" | "unavailable";

export interface PriceQuote {
  asset: string;
  /** USD per unit as a decimal string; null when unavailable. */
  price: string | null;
  currency: "USD";
  source: PriceSource;
  updatedAt: string | null;
  volume?: string;
  confidence?: number;
}

export type PriceHistoryRange = "24h" | "7d" | "30d" | "1y";

export interface PriceHistoryPoint {
  t: string;
  price: string | null;
  filled: boolean;
}

export interface PriceHistory {
  asset: string;
  currency: "USD";
  range: PriceHistoryRange;
  resolution: string;
  intervalSeconds: number;
  source: "stellar_dex" | "unavailable";
  from: string;
  to: string;
  points: PriceHistoryPoint[];
}

/** Backend cap on one batch lookup. */
export const MAX_PRICE_BATCH = 50;

export function priceApi(client: ApiClient) {
  return {
    /** GET /api/v1/price?assets=XLM,USDC:G... (max 50, de-duplicated server-side). */
    async many(assets: string[], signal?: AbortSignal): Promise<PriceQuote[]> {
      if (assets.length === 0) return [];
      const { prices } = await client.get<{ currency: "USD"; prices: PriceQuote[] }>("/api/v1/price", {
        query: { assets: assets.slice(0, MAX_PRICE_BATCH).join(",") },
        auth: false,
        signal,
      });
      return prices;
    },

    one(asset: string, signal?: AbortSignal) {
      return client.get<PriceQuote>(`/api/v1/price/${encodeURIComponent(asset)}`, { auth: false, signal });
    },

    history(asset: string, range: PriceHistoryRange = "7d", signal?: AbortSignal) {
      return client.get<PriceHistory>(`/api/v1/price/${encodeURIComponent(asset)}/history`, {
        query: { range },
        auth: false,
        signal,
      });
    },
  };
}

export type PriceApi = ReturnType<typeof priceApi>;
