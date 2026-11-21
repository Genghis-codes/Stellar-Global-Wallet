/**
 * Fiat FX rates for local-currency price display and historical conversions.
 *
 * Current rates are USD-based (one request returns every quote currency) and
 * cached in-process for FX_CACHE_TTL_MS (default 1h) — FX moves slowly
 * relative to how often price routes are hit, and the free upstream is
 * rate-limited. Concurrent cache misses share one in-flight request.
 *
 * For historical conversions (e.g., tax reporting), daily snapshots are
 * stored in the database and used for transactions dated in the past.
 *
 * If a refresh fails and a previous rate set exists, it's served with
 * `stale: true` rather than failing the request; with nothing cached the
 * caller gets a retryable 503 FX_UNAVAILABLE.
 */
import { Pool } from "pg";
import { config } from "../config";
import { AppError } from "../errors/appError";
import { tError } from "./i18nHelper";
import { FxRateSnapshot, FxSnapshotService } from "./fxSnapshot";
import { FX_BASE_CURRENCY, type FiatCurrency, isSupportedCurrency } from "./fx";

/**
 * Currencies accepted by `?currency=`. A fixed list (rather than "whatever
 * the upstream returns") so validation never needs a network call and the
 * set clients can rely on doesn't change when the provider does.
 */
export const SUPPORTED_CURRENCIES = [
  "USD", "EUR", "GBP", "NGN", "KES", "GHS", "ZAR", "EGP", "MAD", "UGX",
  "TZS", "XOF", "XAF", "BRL", "MXN", "ARS", "COP", "CLP", "PEN", "CAD",
  "INR", "PKR", "BDT", "PHP", "IDR", "VND", "THB", "MYR", "SGD", "CNY",
  "JPY", "KRW", "AUD", "NZD", "TRY", "AED", "SAR", "CHF", "SEK", "NOK",
] as const;

export type FiatCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/**
 *FX Quote with historical conversion context.
 * Added for historical conversions.
 */
export interface HistoricalFxQuote extends FxQuote {
  /**
   * When the rate snapshot was taken (ISO 8601). Different from `updatedAt`
   * when using historical snapshots.
   */
  snapshotDate: string | null;
}

/**
 * Quote with historical context (current or historical).
 */
export interface FxQuoteWithHistory {
  quote: HistoricalFxQuote;
  /**
   * True when the rate was taken from a historical snapshot.
   * When false, this is a live quote from the upstream.
   */
  isHistorical: boolean;
}

export class UnsupportedCurrencyError extends AppError {
  constructor(currency: string, locale = "en") {
    super(
      tError("UNSUPPORTED_CURRENCY", locale, {
        currency,
        supported: SUPPORTED_CURRENCIES.join(", "),
      }),
      {
        code: "UNSUPPORTED_CURRENCY",
        status: 400,
        details: { currency, supported: [...SUPPORTED_CURRENCIES] },
      }
    );
  }
}

export class FxUnavailableError extends AppError {
  constructor(locale = "en") {
    super(tError("FX_UNAVAILABLE", locale), { code: "FX_UNAVAILABLE", status: 503, retryable: true });
  }
}

/**
 * Validate a raw `?currency=` value (case-insensitive). Absent → USD.
 * Throws UnsupportedCurrencyError (400) for anything not in the list.
 */
export function parseCurrency(raw: unknown, locale = "en"): FiatCurrency {
  if (raw === undefined || raw === "") return FX_BASE_CURRENCY;
  const value = typeof raw === "string" ? raw.trim().toUpperCase() : String(raw);
  if (!isSupportedCurrency(value)) throw new UnsupportedCurrencyError(value, locale);
  return value;
}

interface RateSet {
  rates: Record<string, number>;
  updatedAt: string;
  fetchedAt: number;
}

interface ErApiResponse {
  result?: string;
  base_code?: string;
  time_last_update_unix?: number;
  rates?: Record<string, number>;
}

type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class FxService {
  private cache: RateSet | undefined;
  private inflight: Promise<RateSet> | undefined;

  constructor(
    private readonly pool: Pool,
    private readonly fetchFn: FetchFn = (url) => fetch(url),
    private readonly url: string = config.FX_API_URL,
    private readonly ttlMs: number = config.FX_CACHE_TTL_MS,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * USD → `currency` rate for the current date. USD itself never hits the network.
   * For historical rates, use `getHistoricalQuote`.
   */
  async getQuote(currency: FiatCurrency, locale = "en"): Promise<HistoricalFxQuote> {
    if (currency === FX_BASE_CURRENCY) {
      return {
        base: FX_BASE_CURRENCY,
        quote: currency,
        rate: "1",
        source: "identity",
        updatedAt: new Date(this.now()).toISOString(),
        stale: false,
        snapshotDate: null,
      };
    }

    let set: RateSet;
    let stale = false;
    try {
      set = await this.getRates();
    } catch (err) {
      if (!this.cache) {
        console.warn(`[fx] rate fetch failed with no cached rates: ${err}`);
        throw new FxUnavailableError(locale);
      }
      console.warn(`[fx] rate refresh failed, serving stale rates: ${err}`);
      set = this.cache;
      stale = true;
    }

    const rate = set.rates[currency];
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      // Supported by us but missing upstream — treat as unavailable rather
      // than inventing a rate.
      throw new FxUnavailableError(locale);
    }

    return {
      base: FX_BASE_CURRENCY,
      quote: currency,
      rate: String(rate),
      source: new URL(this.url).host,
      updatedAt: set.updatedAt,
      stale,
      snapshotDate: null,
    };
  }

  /**
   * Get the FX rate for a specific date (for historical conversions).
   * Falls back to current rate if no snapshot exists for the requested date.
   */
  async getHistoricalQuote(
    date: Date,
    currency: FiatCurrency,
    locale = "en"
  ): Promise<HistoricalFxQuote> {
    if (currency === FX_BASE_CURRENCY) {
      return {
        base: FX_BASE_CURRENCY,
        quote: currency,
        rate: "1",
        source: "identity",
        updatedAt: new Date(this.now()).toISOString(),
        stale: false,
        snapshotDate: date.toISOString().slice(0, 10),
      };
    }

    const snapshotService = new FxSnapshotService(this.pool);
    const snapshotDate = date.toISOString().slice(0, 10);

    // Try to get historical snapshot first
    const historical = await snapshotService.getRateOnDate(snapshotDate, FX_BASE_CURRENCY, currency);

    if (historical) {
      return {
        base: FX_BASE_CURRENCY,
        quote: currency,
        rate: historical.rate,
        source: historical.source,
        updatedAt: historical.createdAt,
        stale: false,
        snapshotDate: historical.date,
      };
    }

    // No historical snapshot - use current live rate
    const quote = await this.getQuote(currency, locale);
    return {
      ...quote,
      snapshotDate: null, // Indicates we used the current rate
    };
  }

  private async getRates(): Promise<RateSet> {
    if (this.cache && this.now() - this.cache.fetchedAt < this.ttlMs) {
      return this.cache;
    }
    if (!this.inflight) {
      this.inflight = this.fetchRates().finally(() => {
        this.inflight = undefined;
      });
    }
    return this.inflight;
  }

  private async fetchRates(): Promise<RateSet> {
    const res = await this.fetchFn(this.url);
    if (!res.ok) throw new Error(`FX upstream responded ${res.status}`);
    const body = (await res.json()) as ErApiResponse;
    if (body.result !== "success" || body.base_code !== FX_BASE_CURRENCY || !body.rates) {
      throw new Error("FX upstream returned an unexpected payload");
    }
    const set: RateSet = {
      rates: body.rates,
      updatedAt: body.time_last_update_unix
        ? new Date(body.time_last_update_unix * 1000).toISOString()
        : new Date(this.now()).toISOString(),
      fetchedAt: this.now(),
    };
    this.cache = set;
    return set;
  }
}

/**
 * Convert a USD decimal string with an FX rate. Display precision only
 * (float multiply, 2–7 dp) — never use the result for settlement.
 */
export function convertFromUsd(amountUsd: string | null, rate: string): string | null {
  if (amountUsd === null) return null;
  try {
    const [rateWhole, rateFrac = ""] = rate.split(".");
    const rateScale = rateFrac.length;
    const rateInt = BigInt(rateWhole + rateFrac);

    const [usdWhole, usdFrac = ""] = amountUsd.split(".");
    const usdScale = usdFrac.length;
    const usdInt = BigInt(usdWhole + usdFrac);

    const product = usdInt * rateInt;
    const totalScale = rateScale + usdScale;
    const divisor = 10n ** BigInt(totalScale);

    const whole = product / divisor;
    const rem = product % divisor;

    const targetDecimals = whole >= 1n ? 2 : 7;
    const factor = 10n ** BigInt(targetDecimals);
    const scaledRem = (rem * factor + divisor / 2n) / divisor;
    const finalRemStr = scaledRem.toString().padStart(targetDecimals, "0").slice(0, targetDecimals);

    return `${whole}.${finalRemStr}`;
  } catch {
    const value = Number(amountUsd) * Number(rate);
    if (!Number.isFinite(value)) return null;
    return value >= 1 ? value.toFixed(2) : value.toFixed(7);
  }
}
