/**
 * Display formatting for addresses and Stellar amounts.
 *
 * Stellar amounts are decimal strings with up to 7 fractional digits
 * ("12.3400000"). They are formatted as strings, never through Number, so
 * large balances keep every digit.
 */

/** Shorten a G.../M.../C... address to "GABC…WXYZ". Short values pass through. */
export function truncateAddress(address: string, lead = 4, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

export interface FormatAmountOptions {
  /** Maximum fractional digits shown (rounded half-up). Default 7. */
  maxDecimals?: number;
  /** Minimum fractional digits shown (zero-padded). Default 0. */
  minDecimals?: number;
  /** Group the integer part with commas. Default true. */
  group?: boolean;
}

const AMOUNT_PATTERN = /^(-)?(\d*)(?:\.(\d*))?$/;

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Add one unit to the last place of a digit string ("199" -> "200"). */
function incrementDigits(digits: string): string {
  const out = digits.split("");
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] === "9") {
      out[i] = "0";
    } else {
      out[i] = String(Number(out[i]) + 1);
      return out.join("");
    }
  }
  return `1${out.join("")}`;
}

/**
 * Format a decimal amount string for display. Returns the input unchanged
 * when it is not a plain decimal number.
 */
export function formatAmount(amount: string | number, options: FormatAmountOptions = {}): string {
  const { maxDecimals = 7, minDecimals = 0, group = true } = options;
  const raw = typeof amount === "number" ? amount.toFixed(Math.min(maxDecimals, 20)) : amount.trim();
  const match = AMOUNT_PATTERN.exec(raw);
  if (!match || (match[2] === "" && (match[3] ?? "") === "")) return String(amount);

  const negative = match[1] === "-";
  let integer = (match[2] ?? "").replace(/^0+(?=\d)/, "") || "0";
  let fraction = match[3] ?? "";

  if (fraction.length > maxDecimals) {
    const roundUp = Number(fraction[maxDecimals]) >= 5;
    fraction = fraction.slice(0, maxDecimals);
    if (roundUp) {
      const bumped = incrementDigits(integer + fraction);
      integer = bumped.slice(0, bumped.length - fraction.length) || "0";
      fraction = bumped.slice(bumped.length - fraction.length);
      if (maxDecimals === 0) fraction = "";
    }
  }

  fraction = fraction.replace(/0+$/, "");
  if (fraction.length < minDecimals) fraction = fraction.padEnd(minDecimals, "0");

  const isZero = /^0*$/.test(integer) && /^0*$/.test(fraction);
  const sign = negative && !isZero ? "-" : "";
  const intPart = group ? groupThousands(integer) : integer;
  return fraction ? `${sign}${intPart}.${fraction}` : `${sign}${intPart}`;
}

/** Compact form for large figures: 1.2K, 3.4M, 5.6B. Uses Number; display only. */
export function formatCompact(amount: string | number): string {
  const value = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(value)) return String(amount);
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

/** Format a fiat value ("12.5" -> "$12.50"). */
export function formatFiat(amount: string | number, currency = "USD"): string {
  const value = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}
