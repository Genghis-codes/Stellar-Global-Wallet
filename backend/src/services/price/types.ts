import * as StellarSdk from "@stellar/stellar-sdk";
import { isValidIssuedAsset } from "../../validation/stellarAsset";

/** An asset as the price API understands it. */
export type PriceAsset = { type: "native" } | { type: "issued"; code: string; issuer: string };

/**
 * Where a price came from. `unavailable` means no provider could price the
 * asset (e.g. an illiquid token) — the API returns `price: null` rather
 * than inventing a number.
 */
export type PriceSource = "stellar_dex" | "coingecko" | "consensus" | "unavailable";

export interface PriceQuote {
  /** Canonical asset id: `XLM` or `CODE:ISSUER`. */
  asset: string;
  /** Decimal string, USD per one unit of `asset`; null when unavailable. */
  price: string | null;
  currency: "USD";
  source: PriceSource;
  /** ISO-8601 time the provider observed the price; null when unavailable. */
  updatedAt: string | null;
  /**
   * Total base volume traded in the last aggregation period. Present for
   * DEX prices; may be absent for external providers.
   */
  volume?: string;
  /**
   * Confidence: 0.0 to 1.0. Based on volume, spread, freshness, and
   * agreement across providers. Below 0.5 should be treated with caution.
   */
  confidence?: number;
}

export interface ProviderQuote {
  price: string;
  updatedAt: string;
  /**
   * Base volume traded in the last aggregation period (DEX) or
   * 24h volume (CoinGecko). Absent when unknown or unavailable.
   */
  volume?: string;
  /**
   * Confidence: 0.0 to 1.0. Based on volume, spread, freshness, and
   * agreement across providers. Below 0.5 should be treated with caution.
   */
  confidence?: number;
}

export interface PriceProvider {
  readonly name: Exclude<PriceSource, "unavailable" | "consensus">;
  /**
   * Prices as many of `assets` as this provider can. Assets it cannot
   * price are simply absent from the returned map (keyed by assetId) so
   * the next provider can try them. Throwing means "this provider is down"
   * and is treated the same as returning an empty map.
   */
  getPrices(assets: readonly PriceAsset[]): Promise<Map<string, ProviderQuote>>;
}

export function assetId(asset: PriceAsset): string {
  return asset.type === "native" ? "XLM" : `${asset.code}:${asset.issuer}`;
}

/**
 * Parses `XLM` / `native` (case-insensitive) or `CODE:ISSUER` (issuer
 * checksum-validated). Anything else — including a bare code like `USDC`,
 * which is ambiguous and exactly what a lookalike asset relies on — is
 * rejected by returning null.
 */
export function parseAssetId(raw: string): PriceAsset | null {
  const value = raw.trim();
  if (/^(xlm|native)$/i.test(value)) return { type: "native" };
  if (!isValidIssuedAsset(value)) return null;
  const [code, issuer] = value.split(":");
  return { type: "issued", code, issuer };
}

/**
 * Volume-weighted price for a single provider's orderbook trades.
 * `price` is the VWAP; `volume` is the total base volume traded.
 */
export interface VolumeWeightedPrice {
  price: string;
  volume: string;
  updatedAt: string;
}

export function toSdkAsset(asset: PriceAsset): StellarSdk.Asset {
  return asset.type === "native" ? StellarSdk.Asset.native() : new StellarSdk.Asset(asset.code, asset.issuer);
}

/**
 * Formats a positive number as a plain decimal string (never exponent
 * notation), keeping 7 decimals for prices >= 1 and up to 12 below that so
 * sub-cent tokens don't collapse to "0".
 */
export function formatPrice(value: number): string {
  const fixed = value.toFixed(value >= 1 ? 7 : 12);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

/**
 * Parses a decimal price string back to number.
 */
export function parsePrice(value: string): number {
  return Number(value);
}

/**
 * Computes volume-weighted average price from an array of (price, volume)
 * pairs. Returns null if total volume is 0 or input is empty.
 */
export function computeVwap(pairs: readonly { price: number; volume: number }[]): number | null {
  if (pairs.length === 0) return null;
  let totalValue = 0;
  let totalVolume = 0;
  for (const { price, volume } of pairs) {
    totalValue += price * volume;
    totalVolume += volume;
  }
  if (totalVolume <= 0) return null;
  return totalValue / totalVolume;
}

/**
 * Median of an array. Returns null for empty input.
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Interquartile range for outlier detection. Returns {q1, q3, iqr}.
 */
export function quartiles(values: readonly number[]): { q1: number; q3: number; iqr: number } | null {
  if (values.length < 4) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1Index = Math.floor(sorted.length * 0.25);
  const q3Index = Math.floor(sorted.length * 0.75);
  const q1 = sorted[q1Index];
  const q3 = sorted[q3Index];
  return { q1, q3, iqr: q3 - q1 };
}

/**
 * Rejects outliers using the IQR method. Returns values that are within
 * [q1 - 1.5*iqr, q3 + 1.5*iqr].
 */
export function rejectOutliers(values: readonly number[]): number[] {
  const stats = quartiles(values);
  if (!stats) return [...values];
  const lower = stats.q1 - 1.5 * stats.iqr;
  const upper = stats.q3 + 1.5 * stats.iqr;
  return values.filter((v) => v >= lower && v <= upper);
}

/**
 * Computes price confidence based on:
 * - Volume (higher volume = more reliable)
 * - Spread (tight spread = more reliable)
 * - Freshness (recent = more reliable)
 * - Agreement across providers (more agreement = more reliable)
 */
export function computeConfidence(options: {
  volume?: string;
  spread?: number;
  freshnessSeconds?: number;
  providerCount?: number;
  providerAgreement?: number; // 0-1, fraction of providers that agree
}): number {
  const { volume, spread, freshnessSeconds, providerCount = 2, providerAgreement = 1 } = options;

  // Volume score: 0.5 for $1k volume, 1.0 for $100k+, scaled
  const volumeScore = (() => {
    if (!volume) return 0.4;
    const vol = Number(volume);
    if (vol <= 0) return 0.4;
    if (vol >= 100_000) return 1.0;
    return 0.4 + 0.6 * Math.log10(vol / 1000); // log scale
  })();

  // Spread score: 0% spread = 1.0, 10% spread = 0.0, scaled
  const spreadScore = (() => {
    if (typeof spread !== "number" || spread < 0) return 0.8;
    if (spread >= 0.1) return 0.0;
    return 1.0 - spread * 10; // linear decay
  })();

  // Freshness score: 0s = 1.0, 5min = 0.5, 15min = 0.0, scaled
  const freshnessScore = (() => {
    if (typeof freshnessSeconds !== "number" || freshnessSeconds <= 0) return 1.0;
    if (freshnessSeconds >= 900) return 0.0;
    return 1.0 - freshnessSeconds / 900; // linear decay over 15min
  })();

  // Agreement score: based on provider consensus
  const agreementScore = providerAgreement ?? 1.0;

  // Weighted combination (weights can be tuned)
  const weights = { volume: 0.3, spread: 0.25, freshness: 0.25, agreement: 0.2 };
  const score =
    volumeScore * weights.volume +
    spreadScore * weights.spread +
    freshnessScore * weights.freshness +
    agreementScore * weights.agreement;

  return Math.min(1.0, Math.max(0.0, Number(score.toFixed(2))));
}
