import type { PriceQuote } from "@/lib/api/endpoints/price";

/**
 * Fiat valuation of Stellar balances. Amounts and prices are decimal
 * strings; the multiplication is done in BigInt so large balances don't lose
 * precision. Results are rounded to `FIAT_DECIMALS` places (display only).
 */

export const FIAT_DECIMALS = 8;

/** Quotes older than this are shown as stale (matches the backend consensus default). */
export const PRICE_STALE_AFTER_MS = 5 * 60_000;

const DECIMAL = /^(-)?(\d*)(?:\.(\d*))?$/;

function toScaled(value: string): { digits: bigint; scale: number } | null {
  const match = DECIMAL.exec(value.trim());
  if (!match || (match[2] === "" && (match[3] ?? "") === "")) return null;
  const fraction = match[3] ?? "";
  const digits = BigInt(`${match[2] || "0"}${fraction}`);
  return { digits: match[1] ? -digits : digits, scale: fraction.length };
}

function fromScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const abs = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const integer = abs.slice(0, abs.length - scale);
  const fraction = abs.slice(abs.length - scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

/** `amount × price` as a decimal string rounded half-up to FIAT_DECIMALS, or null for bad input. */
export function multiplyDecimal(amount: string, price: string): string | null {
  const a = toScaled(amount);
  const p = toScaled(price);
  if (!a || !p) return null;
  const product = a.digits * p.digits;
  const scale = a.scale + p.scale;
  if (scale <= FIAT_DECIMALS) return fromScaled(product * 10n ** BigInt(FIAT_DECIMALS - scale), FIAT_DECIMALS);
  const divisor = 10n ** BigInt(scale - FIAT_DECIMALS);
  const half = divisor / 2n;
  const rounded = product >= 0n ? (product + half) / divisor : (product - half) / divisor;
  return fromScaled(rounded, FIAT_DECIMALS);
}

/** Sum of decimal strings at FIAT_DECIMALS precision (malformed entries are skipped). */
export function sumDecimals(values: string[]): string {
  let total = 0n;
  for (const value of values) {
    const rounded = multiplyDecimal(value, "1");
    if (rounded === null) continue;
    const { digits, scale } = toScaled(rounded)!;
    total += digits * 10n ** BigInt(FIAT_DECIMALS - scale);
  }
  return fromScaled(total, FIAT_DECIMALS);
}

export type QuoteState = "fresh" | "stale" | "missing";

/** Whether a quote can be used: missing (no price), stale (old) or fresh. */
export function quoteState(quote: PriceQuote | undefined, now = Date.now()): QuoteState {
  if (!quote || quote.price === null || quote.source === "unavailable") return "missing";
  if (!quote.updatedAt) return "stale";
  const at = Date.parse(quote.updatedAt);
  if (Number.isNaN(at) || now - at > PRICE_STALE_AFTER_MS) return "stale";
  return "fresh";
}

export interface Holding {
  asset: string;
  amount: string;
}

export interface Valuation {
  asset: string;
  amount: string;
  /** Fiat value, or null when no price is available. */
  value: string | null;
  price: string | null;
  state: QuoteState;
}

export interface PortfolioValuation {
  /** Sum of every holding that has a price (stale prices included). */
  total: string;
  holdings: Valuation[];
  missing: string[];
  stale: string[];
}

/** Value each holding with its quote and total the portfolio. */
export function valuePortfolio(holdings: Holding[], quotes: PriceQuote[], now = Date.now()): PortfolioValuation {
  const byAsset = new Map(quotes.map((quote) => [quote.asset, quote]));
  const valued = holdings.map<Valuation>(({ asset, amount }) => {
    const quote = byAsset.get(asset);
    const state = quoteState(quote, now);
    const price = state === "missing" ? null : quote!.price;
    return { asset, amount, price, state, value: price === null ? null : multiplyDecimal(amount, price) };
  });
  return {
    total: sumDecimals(valued.flatMap((v) => (v.value === null ? [] : [v.value]))),
    holdings: valued,
    missing: valued.filter((v) => v.state === "missing").map((v) => v.asset),
    stale: valued.filter((v) => v.state === "stale").map((v) => v.asset),
  };
}
