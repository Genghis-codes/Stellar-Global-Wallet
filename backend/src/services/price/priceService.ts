import { TtlCache } from "../ttlCache";
import { PriceAsset, PriceProvider, PriceQuote, assetId, ProviderQuote } from "./types";
import { computeConsensusPrice, ProviderContribution } from "./priceConsensus";

/**
 * Spot prices with provider fallback and consensus aggregation.
 *
 * For each asset not in the cache:
 * 1. All providers try to price it (batched for efficiency)
 * 2. Prices are combined using VWAP (for DEX) and median consensus (across providers)
 * 3. Outliers are rejected, confidence is calculated
 * 4. The consensus result is cached
 *
 * Providers receive every still-unpriced asset in one call, so a batch of
 * 50 misses costs one CoinGecko request rather than 50. Concurrent
 * requests for the same uncached asset share one upstream lookup.
 */
export class PriceService {
  private readonly cache: TtlCache<PriceQuote>;
  private readonly inFlight = new Map<string, Promise<PriceQuote>>();

  constructor(
    private readonly providers: readonly PriceProvider[],
    ttlMs: number,
    now: () => number = Date.now
  ) {
    this.cache = new TtlCache<PriceQuote>(ttlMs, now);
  }

  async getPrice(asset: PriceAsset): Promise<PriceQuote> {
    const [quote] = await this.getPrices([asset]);
    return quote;
  }

  /** Returns one quote per input asset, in input order. Callers dedupe. */
  async getPrices(assets: readonly PriceAsset[]): Promise<PriceQuote[]> {
    const pending = new Map<string, Promise<PriceQuote>>();
    const misses: PriceAsset[] = [];

    for (const asset of assets) {
      const id = assetId(asset);
      if (pending.has(id)) continue;
      const cached = this.cache.get(id);
      if (cached) {
        pending.set(id, Promise.resolve(cached));
        continue;
      }
      const inFlight = this.inFlight.get(id);
      if (inFlight) {
        pending.set(id, inFlight);
        continue;
      }
      misses.push(asset);
    }

    if (misses.length > 0) {
      const lookup = this.resolve(misses);
      for (const asset of misses) {
        const id = assetId(asset);
        const promise = lookup.then((byId) => byId.get(id) as PriceQuote);
        this.inFlight.set(id, promise);
        pending.set(id, promise);
      }
      lookup.finally(() => {
        for (const asset of misses) this.inFlight.delete(assetId(asset));
      }).catch(() => undefined);
    }

    return Promise.all(assets.map((asset) => pending.get(assetId(asset)) as Promise<PriceQuote>));
  }

  /** Drops one asset's cached price (or all of them). */
  invalidate(asset?: PriceAsset): void {
    if (asset) this.cache.delete(assetId(asset));
    else this.cache.clear();
  }

  private async resolve(assets: readonly PriceAsset[]): Promise<Map<string, PriceQuote>> {
    const result = new Map<string, PriceQuote>();
    const providerQuotes = new Map<string, Map<string, ProviderQuote & { provider: string }>>();

    // Collect quotes from all providers
    for (const provider of this.providers) {
      try {
        const quotes = await provider.getPrices(assets);
        const providerMap = new Map<string, ProviderQuote & { provider: string }>();
        for (const [id, quote] of quotes) {
          providerMap.set(id, { ...quote, provider: provider.name });
        }
        providerQuotes.set(provider.name, providerMap);
      } catch (err) {
        console.error(`[price] provider ${provider.name} failed:`, (err as Error).message);
      }
    }

    // Aggregate for each asset
    for (const asset of assets) {
      const id = assetId(asset);
      const contributions: ProviderContribution[] = [];

      for (const [providerName, quotes] of providerQuotes) {
        const quote = quotes.get(id);
        if (quote && quote.price) {
          const price = Number(quote.price);
          if (isFinite(price) && price > 0) {
            contributions.push({
              provider: providerName,
              price,
              volume: quote.volume,
              confidence: quote.confidence,
              updatedAt: quote.updatedAt,
            });
          }
        }
      }

      const consensus = computeConsensusPrice(contributions);

      if (consensus) {
        result.set(id, {
          asset: id,
          price: consensus.price,
          currency: "USD",
          source: consensus.source,
          updatedAt: consensus.updatedAt,
          volume: consensus.volume,
          confidence: consensus.confidence,
        });
      } else {
        result.set(id, {
          asset: id,
          price: null,
          currency: "USD",
          source: "unavailable",
          updatedAt: null,
        });
      }
    }

    for (const quote of result.values()) this.cache.set(quote.asset, quote);
    return result;
  }
}
