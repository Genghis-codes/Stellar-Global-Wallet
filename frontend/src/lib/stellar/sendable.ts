import { MAX_DECIMALS, compareAmounts, fromStroops, isValidAmount, toStroops } from "./amount";

/**
 * The most a user can send of one asset. `spendable` comes from
 * /account/:id/reserves (balance minus reserves and selling liabilities);
 * for XLM the network fee is taken out as well.
 */
export function maxSendable(spendable: string, native: boolean, feeStroops: string | bigint = 0n): string {
  const max = toStroops(spendable) - (native ? BigInt(feeStroops) : 0n);
  return fromStroops(max > 0n ? max : 0n);
}

export interface AmountRules {
  /** Largest allowed amount (see maxSendable). */
  max?: string;
  /** Asset code for messages. */
  assetCode?: string;
}

/** An error message for a user-typed amount, or null when it can be sent. */
export function amountError(input: string, { max, assetCode = "" }: AmountRules = {}): string | null {
  const value = input.trim();
  if (value === "") return "Enter an amount.";
  if (/^\d*\.\d{8,}$/.test(value)) return `Use at most ${MAX_DECIMALS} decimal places.`;
  if (!isValidAmount(value)) return "Enter a valid amount, e.g. 12.5.";
  if (toStroops(value) === 0n) return "Amount must be greater than zero.";
  if (max !== undefined && compareAmounts(value, max) > 0) {
    return `You can send at most ${max}${assetCode ? ` ${assetCode}` : ""}.`;
  }
  return null;
}
