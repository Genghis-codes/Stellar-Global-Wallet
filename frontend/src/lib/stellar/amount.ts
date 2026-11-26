/**
 * Stellar amounts: decimal strings with at most 7 fractional digits,
 * 1 unit = 10^7 stroops. Conversions use BigInt so no precision is lost.
 */

export const STROOPS_PER_UNIT = 10_000_000n;
export const MAX_DECIMALS = 7;
/** Largest representable amount (int64 stroops). */
export const MAX_AMOUNT = "922337203685.4775807";

const AMOUNT_RE = /^\d+(\.\d{1,7})?$/;

/** A positive-or-zero decimal string Stellar accepts as an amount. */
export function isValidAmount(value: string): boolean {
  if (!AMOUNT_RE.test(value)) return false;
  return toStroops(value) <= toStroops(MAX_AMOUNT);
}

export function toStroops(amount: string): bigint {
  const [whole = "0", fraction = ""] = amount.trim().split(".");
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > MAX_DECIMALS) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  return BigInt(whole || "0") * STROOPS_PER_UNIT + BigInt(fraction.padEnd(MAX_DECIMALS, "0") || "0");
}

export function fromStroops(stroops: bigint | string | number): string {
  const value = BigInt(stroops);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / STROOPS_PER_UNIT;
  const fraction = (abs % STROOPS_PER_UNIT).toString().padStart(MAX_DECIMALS, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** -1, 0 or 1, comparing two amount strings exactly. */
export function compareAmounts(a: string, b: string): -1 | 0 | 1 {
  const x = toStroops(a);
  const y = toStroops(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

export function addAmounts(a: string, b: string): string {
  return fromStroops(toStroops(a) + toStroops(b));
}

export function subtractAmounts(a: string, b: string): string {
  return fromStroops(toStroops(a) - toStroops(b));
}
