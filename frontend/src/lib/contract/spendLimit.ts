import { fromStroops, isValidAmount, toStroops } from "@/lib/stellar/amount";

/**
 * Spend-limit rules of the globe-wallet contract (`set_spend_limit`,
 * contract/contracts/globe-wallet/src/lib.rs, issue #176):
 *
 * - Limits are a rolling 24 h cap per asset, stored in stroops; 0 = unlimited.
 * - A decrease (any non-zero limit ≤ the current one, or any non-zero limit
 *   while unlimited) applies at once and discards a queued increase.
 * - An increase, or switching to unlimited, is queued for 24 h
 *   (`SPEND_LIMIT_INCREASE_DELAY_SECS`). Setting the same limit again is a
 *   no-op that also discards the queued increase, which is how the app
 *   cancels one (the backend has no cancel route).
 * - A lower limit below what was already spent in the window is rejected
 *   (`SpendLimitExceeded`).
 */

export const SPEND_LIMIT_INCREASE_DELAY_MS = 24 * 60 * 60 * 1000;

export type SpendLimitChange = "decrease" | "increase" | "noop";

/** How the contract will treat moving from `current` to `next` (both stroops; 0 = unlimited). */
export function classifySpendLimitChange(current: bigint, next: bigint): SpendLimitChange {
  if (next === current) return "noop";
  if (next !== 0n && (current === 0n || next <= current)) return "decrease";
  return "increase";
}

export interface SpendLimitInput {
  /** Decimal amount to send to the backend ("0" = unlimited). */
  limit: string;
  stroops: bigint;
  change: SpendLimitChange;
}

/**
 * Validate a limit typed by the user against the current allowance.
 * `unlimited` ignores the text and asks to remove the limit.
 */
export function parseSpendLimitInput(
  raw: string,
  current: { limit: string; spent: string },
  unlimited = false,
): SpendLimitInput | { error: string } {
  const currentStroops = BigInt(current.limit);
  if (unlimited) {
    return { limit: "0", stroops: 0n, change: classifySpendLimitChange(currentStroops, 0n) };
  }
  const text = raw.trim();
  if (!isValidAmount(text) || toStroops(text) === 0n) {
    return { error: "Enter an amount greater than 0 with up to 7 decimals." };
  }
  const stroops = toStroops(text);
  const change = classifySpendLimitChange(currentStroops, stroops);
  if (change === "decrease" && stroops < BigInt(current.spent)) {
    return {
      error: `You've already spent ${fromStroops(current.spent)} in the last 24 hours; the limit can't be lower than that.`,
    };
  }
  return { limit: fromStroops(stroops), stroops, change };
}

/** A queued increase the app knows about (the backend can't read them back yet). */
export interface PendingSpendLimit {
  assetCode: string;
  /** New limit in stroops ("0" = unlimited). */
  limit: string;
  /** Limit in force until then, in stroops. */
  previousLimit: string;
  /** ISO time the increase takes effect. */
  effectiveAt: string;
  /** Hash of the transaction that queued it. */
  hash?: string;
}

const KEY_PREFIX = "gw.pendingSpendLimits.";

/**
 * Remembers queued increases per account in Web Storage so the countdown
 * survives reloads. Entries drop off once they mature or are cancelled.
 */
export function pendingSpendLimitStore(storage: () => Storage | undefined) {
  function read(account: string): PendingSpendLimit[] {
    try {
      const raw = storage()?.getItem(KEY_PREFIX + account);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as PendingSpendLimit[]) : [];
    } catch {
      return [];
    }
  }

  function write(account: string, items: PendingSpendLimit[]): void {
    try {
      if (items.length === 0) storage()?.removeItem(KEY_PREFIX + account);
      else storage()?.setItem(KEY_PREFIX + account, JSON.stringify(items));
    } catch {
      // Storage full or disabled: the countdown just won't persist.
    }
  }

  return {
    /** Queued increases that haven't matured yet. */
    list(account: string, now: number = Date.now()): PendingSpendLimit[] {
      const items = read(account);
      const live = items.filter((item) => Date.parse(item.effectiveAt) > now);
      if (live.length !== items.length) write(account, live);
      return live;
    },

    /** Record (or replace) the queued increase for an asset. */
    save(account: string, item: PendingSpendLimit): void {
      write(account, [...read(account).filter((p) => p.assetCode !== item.assetCode), item]);
    },

    remove(account: string, assetCode: string): void {
      write(account, read(account).filter((p) => p.assetCode !== assetCode));
    },
  };
}

export type PendingSpendLimitStore = ReturnType<typeof pendingSpendLimitStore>;
