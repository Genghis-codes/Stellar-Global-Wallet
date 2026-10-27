import type { Horizon } from "@stellar/stellar-sdk";
import { fromStroops, toStroops } from "../utils/stroops";

/** Network base reserve: 0.5 XLM per entry (protocol constant since v10). */
export const BASE_RESERVE_STROOPS = 5_000_000n;

type AccountLike = Pick<
  Horizon.AccountResponse,
  "account_id" | "balances" | "signers" | "thresholds" | "subentry_count"
> & {
  num_sponsoring?: number;
  num_sponsored?: number;
};

export interface ReserveBreakdown {
  baseReserve: string;
  subentryCount: number;
  numSponsoring: number;
  numSponsored: number;
  /** XLM locked as the account's minimum balance. */
  minimumBalance: string;
  /** XLM locked by open sell offers. */
  sellingLiabilities: string;
  /** XLM the account can actually send right now. */
  spendable: string;
}

/**
 * #70 — how much of the account's XLM is locked and how much it can send:
 * minimum balance = (2 + subentries + sponsoring - sponsored) x base
 * reserve, plus native selling liabilities. Computed in stroops so it never
 * suffers floating-point drift.
 */
export function computeReserveBreakdown(account: AccountLike): ReserveBreakdown {
  const numSponsoring = account.num_sponsoring ?? 0;
  const numSponsored = account.num_sponsored ?? 0;
  const entries = BigInt(2 + account.subentry_count + numSponsoring - numSponsored);
  const minimum = entries * BASE_RESERVE_STROOPS;

  const native = account.balances.find((b) => b.asset_type === "native") as
    | { balance: string; selling_liabilities?: string }
    | undefined;
  const balance = toStroops(native?.balance ?? "0");
  const liabilities = toStroops(native?.selling_liabilities ?? "0");
  const spendable = balance - minimum - liabilities;

  return {
    baseReserve: fromStroops(BASE_RESERVE_STROOPS),
    subentryCount: account.subentry_count,
    numSponsoring,
    numSponsored,
    minimumBalance: fromStroops(minimum),
    sellingLiabilities: fromStroops(liabilities),
    spendable: fromStroops(spendable > 0n ? spendable : 0n),
  };
}

/** Spendable amount of one balance line: balance minus selling liabilities (and reserve for XLM). */
export function spendableBalance(
  line: { asset_type: string; balance: string; selling_liabilities?: string },
  reserves: ReserveBreakdown
): string {
  if (line.asset_type === "native") return reserves.spendable;
  if (line.asset_type === "liquidity_pool_shares") return line.balance;
  const spendable = toStroops(line.balance) - toStroops(line.selling_liabilities ?? "0");
  return fromStroops(spendable > 0n ? spendable : 0n);
}

export interface MultisigInfo {
  account: string;
  signers: Array<{ key: string; weight: number; type: string; isMaster: boolean }>;
  thresholds: { low: number; medium: number; high: number };
  totalWeight: number;
  /** Whether the combined signer weight can reach each threshold level. */
  reachable: { low: boolean; medium: boolean; high: boolean };
  isMultisig: boolean;
}

/** #72 — signers, weights, thresholds and per-level reachability. */
export function computeMultisigInfo(account: AccountLike): MultisigInfo {
  const signers = account.signers.map((s) => ({
    key: s.key,
    weight: s.weight,
    type: s.type,
    isMaster: s.key === account.account_id,
  }));
  const totalWeight = signers.reduce((sum, s) => sum + s.weight, 0);
  const thresholds = {
    low: account.thresholds.low_threshold,
    medium: account.thresholds.med_threshold,
    high: account.thresholds.high_threshold,
  };
  // A threshold of 0 still needs one signature with weight > 0.
  const reach = (t: number) => totalWeight >= Math.max(t, 1);
  return {
    account: account.account_id,
    signers,
    thresholds,
    totalWeight,
    reachable: { low: reach(thresholds.low), medium: reach(thresholds.medium), high: reach(thresholds.high) },
    isMultisig: signers.filter((s) => s.weight > 0).length > 1,
  };
}
