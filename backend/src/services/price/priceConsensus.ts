import { median, rejectOutliers, computeConfidence, ProviderQuote, formatPrice } from "./types";

/**
 * A single provider's contribution to the consensus price.
 */
export interface ProviderContribution {
  provider: string;
  price: number;
  volume?: string;
  confidence?: number;
  updatedAt: string;
}

/**
 * The final consensus result with confidence score.
 */
export interface ConsensusPrice {
  price: string;
  volume?: string;
  confidence: number;
  updatedAt: string;
  source: string;
}

/**
 * Compute a manipulation-resistant consensus price from multiple providers.
 *
 * Steps:
 * 1. Filter to providers that have valid prices (positive, finite)
 * 2. Compute median across providers
 * 3. Reject outliers using IQR method
 * 4. Re-compute median from clean set (or use single value if only one remains)
 * 5. Calculate confidence based on agreement and provider quality
 */
export function computeConsensusPrice(contributions: ProviderContribution[]): ConsensusPrice | null {
  if (contributions.length === 0) return null;

  // Filter to valid prices
  const valid = contributions.filter((c) => isFinite(c.price) && c.price > 0);
  if (valid.length === 0) return null;

  // Get prices for outlier detection
  const prices = valid.map((c) => c.price);
  const cleanPrices = rejectOutliers(prices);

  // Use clean set if we have enough, otherwise fall back to all valid
  const finalSet = cleanPrices.length >= 2 ? cleanPrices : prices;

  const priceMedian = median(finalSet);
  if (priceMedian === null) return null;

  // Find the provider whose price is closest to median (best representation)
  const bestProvider = valid.find((c) => Math.abs(c.price - priceMedian) < 0.0001) ?? valid[0];

  // Compute confidence based on:
  // - Number of providers that agree (within 2x of median)
  // - Average volume of contributing providers
  // - Freshness of the data
  const agreementCount = valid.filter((c) => c.price >= priceMedian * 0.5 && c.price <= priceMedian * 2).length;
  const providerAgreement = agreementCount / valid.length;

  const avgVolume = valid.reduce((sum, c) => {
    if (!c.volume) return sum;
    const vol = Number(c.volume);
    return sum + (isFinite(vol) ? vol : 0);
  }, 0) / valid.length;

  const now = Date.now();
  const avgAgeSeconds = valid.reduce((sum, c) => {
    const parsed = Date.parse(c.updatedAt);
    if (isNaN(parsed)) return sum;
    return sum + (now - parsed) / 1000;
  }, 0) / valid.length;

  const confidence = computeConfidence({
    volume: avgVolume > 0 ? avgVolume.toFixed(2) : undefined,
    freshnessSeconds: avgAgeSeconds,
    providerAgreement,
  });

  // Volume: use the best provider's volume, or aggregate
  let volume: string | undefined;
  if (bestProvider.volume) {
    volume = bestProvider.volume;
  } else if (valid.length > 0) {
    // Sum volumes if no single best provider
    const total = valid.reduce((sum, c) => sum + (Number(c.volume) || 0), 0);
    if (total > 0) volume = total.toFixed(2);
  }

  // Source: list providers that contributed (within 2x of median)
  const contributing = valid
    .filter((c) => c.price >= priceMedian * 0.5 && c.price <= priceMedian * 2)
    .map((c) => c.provider)
    .sort();

  return {
    price: formatPrice(priceMedian),
    volume,
    confidence,
    updatedAt: bestProvider.updatedAt,
    source: contributing.length > 1 ? `${contributing.join(", ")}` : contributing[0],
  };
}

/**
 * Check if a consensus price is stale and should be considered unreliable.
 */
export function isStale(consensus: ConsensusPrice, maxAgeMs: number = 5 * 60_000): boolean {
  const parsed = Date.parse(consensus.updatedAt);
  if (isNaN(parsed)) return true;
  return Date.now() - parsed > maxAgeMs;
}

/**
 * Check if a consensus price is manipulation-resistant based on confidence.
 */
export function isReliable(consensus: ConsensusPrice, minConfidence: number = 0.5): boolean {
  return consensus.confidence >= minConfidence;
}
