import * as StellarSdk from "@stellar/stellar-sdk";
import { mapLimit } from "./mapLimit";
import { PriceAsset, PriceProvider, ProviderQuote, assetId, formatPrice, toSdkAsset, computeVwap } from "./types";
import { UsdQuoteAsset, isUsdQuoteAsset } from "./usdQuote";

export interface StellarDexProviderOptions {
  /**
   * Reject the book as unreliable when (ask - bid) / mid exceeds this.
   * A thin book with one stray offer on each side would otherwise yield a
   * "price" nobody can actually trade at.
   */
  maxSpread?: number;
  /** Number of orderbook levels to use for VWAP calculation. */
  vwapLevels?: number;
  /** Minimum base volume threshold for a price to be considered reliable. */
  minVolume?: number;
  /** Max concurrent Horizon orderbook requests for one batch. */
  concurrency?: number;
}

/**
 * Spot price from the Stellar DEX: VWAP from multiple orderbook levels.
 * The USD quote asset itself is priced at exactly 1 (every other DEX price
 * is denominated in it).
 *
 * Only direct USDC markets are used; assets that trade solely against XLM
 * (or nothing) are left for the next provider. Both sides of the book must
 * exist — a one-sided book is illiquid and is never turned into a price.
 */
export class StellarDexProvider implements PriceProvider {
  readonly name = "stellar_dex" as const;
  private readonly quote: StellarSdk.Asset;
  private readonly maxSpread: number;
  private readonly vwapLevels: number;
  private readonly minVolume: number;
  private readonly concurrency: number;

  constructor(
    private readonly horizon: StellarSdk.Horizon.Server,
    private readonly usdQuote: UsdQuoteAsset,
    options: StellarDexProviderOptions = {},
    private readonly now: () => number = Date.now
  ) {
    this.quote = new StellarSdk.Asset(usdQuote.code, usdQuote.issuer);
    this.maxSpread = options.maxSpread ?? 0.25;
    this.vwapLevels = options.vwapLevels ?? 10;
    this.minVolume = options.minVolume ?? 1000; // $1k minimum volume
    this.concurrency = options.concurrency ?? 8;
  }

  async getPrices(assets: readonly PriceAsset[]): Promise<Map<string, ProviderQuote>> {
    const out = new Map<string, ProviderQuote>();
    await mapLimit(assets, this.concurrency, async (asset) => {
      try {
        const quote = await this.priceOne(asset);
        if (quote) out.set(assetId(asset), quote);
      } catch (err) {
        // One failing market must not sink the rest of the batch; the
        // asset falls through to the next provider.
        console.error(`[price] stellar_dex failed for ${assetId(asset)}:`, (err as Error).message);
      }
    });
    return out;
  }

  private async priceOne(asset: PriceAsset): Promise<ProviderQuote | null> {
    const updatedAt = new Date(this.now()).toISOString();
    if (asset.type === "issued" && isUsdQuoteAsset(asset.code, asset.issuer, this.usdQuote)) {
      return { price: "1", updatedAt };
    }

    const book = await this.horizon.orderbook(toSdkAsset(asset), this.quote).limit(this.vwapLevels).call();
    const bid = Number.parseFloat(book.bids[0]?.price ?? "");
    const ask = Number.parseFloat(book.asks[0]?.price ?? "");
    if (!(bid > 0) || !(ask > 0) || ask < bid) return null;

    const mid = (bid + ask) / 2;
    if ((ask - bid) / mid > this.maxSpread) return null;

    // Compute VWAP from all levels in the book
    const pairs: { price: number; volume: number }[] = [];

    for (const level of book.bids) {
      const price = Number.parseFloat(level.price);
      const amount = Number.parseFloat(level.amount);
      if (price > 0 && amount > 0) {
        pairs.push({ price, volume: amount });
      }
    }
    for (const level of book.asks) {
      const price = Number.parseFloat(level.price);
      const amount = Number.parseFloat(level.amount);
      if (price > 0 && amount > 0) {
        pairs.push({ price, volume: amount });
      }
    }

    const vwap = computeVwap(pairs);
    if (vwap === null) return null;

    // Total volume across all levels
    const totalVolume = pairs.reduce((sum, p) => sum + p.volume, 0);

    // Reject if volume is too thin
    if (totalVolume < this.minVolume) return null;

    return {
      price: formatPrice(vwap),
      volume: totalVolume.toFixed(7),
      updatedAt,
      confidence: 0.85 + Math.min(0.15, Math.log10(totalVolume / this.minVolume) * 0.05),
    };
  }
}
