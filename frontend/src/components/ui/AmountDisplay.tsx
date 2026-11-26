import { cn } from "@/lib/cn";
import { formatAmount } from "@/lib/format";

export interface AmountDisplayProps {
  /** Decimal amount string as returned by Horizon/the API ("12.3400000"). */
  amount: string | number;
  /** Asset code shown after the amount (XLM, USDC, ...). Omit to hide. */
  asset?: string;
  /** Override the number of decimals; defaults depend on the asset. */
  maxDecimals?: number;
  /** Prefix a + for positive values (incoming payments). */
  signed?: boolean;
  className?: string;
}

/** Stablecoins read best with 2 decimals; everything else keeps Stellar's 7. */
const FIAT_LIKE = new Set(["USDC", "USDT", "EURC", "EURT", "PYUSD"]);

export function defaultDecimalsFor(asset?: string): number {
  return asset && FIAT_LIKE.has(asset.toUpperCase()) ? 2 : 7;
}

export function AmountDisplay({ amount, asset, maxDecimals, signed, className }: AmountDisplayProps) {
  const decimals = maxDecimals ?? defaultDecimalsFor(asset);
  const minDecimals = decimals === 2 ? 2 : 0;
  const formatted = formatAmount(amount, { maxDecimals: decimals, minDecimals });
  const positive = signed && !formatted.startsWith("-") && formatted !== "0";
  return (
    <span className={cn("tabular-nums", className)} title={`${amount}${asset ? ` ${asset}` : ""}`}>
      {positive && "+"}
      {formatted}
      {asset && <span className="ml-1 text-fg-muted">{asset}</span>}
    </span>
  );
}
