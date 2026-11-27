/**
 * Threshold-safety rules for multisig changes, mirrored from the backend's
 * `simulateSetOptions` (backend/src/services/setOptions.ts) so the UI can
 * block a lock-out before building anything. The backend still has the
 * final say (422 SET_OPTIONS_LOCKOUT).
 *
 * Stellar rule of thumb: a transaction is authorised when the signatures'
 * combined weight reaches the threshold of the operations it contains
 * (set-options needs `high`). If the signers' total weight is below any
 * threshold, nobody can ever reach it again: the account is locked out.
 */

/** Signer weights and thresholds are single bytes. */
export const MAX_WEIGHT = 255;

export type ThresholdLevel = "low" | "medium" | "high";

export const THRESHOLD_LEVELS: ThresholdLevel[] = ["low", "medium", "high"];

export interface Thresholds {
  low: number;
  medium: number;
  high: number;
}

export interface Signer {
  key: string;
  weight: number;
}

export interface SignerSet {
  /** The account id; its signer entry is the master key. */
  account: string;
  signers: Signer[];
  thresholds: Thresholds;
}

/** A proposed change, same fields as POST /wallet/set-options/build. */
export interface SignerChange {
  addSigners?: Signer[];
  removeSigners?: string[];
  masterWeight?: number;
  thresholds?: Partial<Thresholds>;
}

export interface SignerChangeResult {
  /** Signers left with weight > 0. */
  signers: Signer[];
  thresholds: Thresholds;
  totalWeight: number;
  /** Blocking problems: the change would lock the account out. */
  problems: string[];
  /** Risks the user should confirm. */
  warnings: string[];
}

export function totalWeight(signers: Signer[]): number {
  return signers.reduce((sum, signer) => sum + signer.weight, 0);
}

/** Apply a change to a signer set and classify the result. */
export function simulateSignerChange(current: SignerSet, change: SignerChange): SignerChangeResult {
  const weights = new Map<string, number>();
  for (const signer of current.signers) weights.set(signer.key, signer.weight);

  if (change.masterWeight !== undefined) weights.set(current.account, change.masterWeight);
  for (const signer of change.addSigners ?? []) weights.set(signer.key, signer.weight);
  for (const key of change.removeSigners ?? []) {
    // The master key can't be removed, only weighted to 0.
    if (key !== current.account) weights.delete(key);
  }

  const thresholds: Thresholds = { ...current.thresholds, ...change.thresholds };
  const signers = [...weights].filter(([, weight]) => weight > 0).map(([key, weight]) => ({ key, weight }));
  const total = totalWeight(signers);

  const problems: string[] = [];
  if (total === 0) problems.push("No signer would have any weight, so nobody could sign for this account.");
  for (const level of THRESHOLD_LEVELS) {
    if (thresholds[level] > total) {
      problems.push(
        `The ${level} threshold (${thresholds[level]}) would be higher than the combined signer weight (${total}).`,
      );
    }
  }

  const warnings: string[] = [];
  if (problems.length === 0) {
    const heaviest = Math.max(...signers.map((s) => s.weight));
    if (signers.length > 1 && heaviest >= thresholds.high) {
      warnings.push("A single signer can still authorise high-threshold changes on its own.");
    }
    if ((weights.get(current.account) ?? 0) === 0) {
      warnings.push("The master key will have no weight; only the other signers can act for this account.");
    }
    for (const signer of signers) {
      if (signers.length > 1 && total - signer.weight < thresholds.high) {
        warnings.push(`Losing ${signer.key} would leave the account unable to meet its high threshold.`);
      }
    }
    if (thresholds.low > thresholds.medium || thresholds.medium > thresholds.high) {
      warnings.push("Thresholds are usually ordered low ≤ medium ≤ high.");
    }
  }

  return { signers, thresholds, totalWeight: total, problems, warnings };
}

/** Whether removing `key` keeps every threshold reachable. */
export function canRemoveSigner(current: SignerSet, key: string): { ok: boolean; reason?: string } {
  if (key === current.account) {
    return { ok: false, reason: "The master key can't be removed; set its weight to 0 instead." };
  }
  const { problems } = simulateSignerChange(current, { removeSigners: [key] });
  return problems.length === 0 ? { ok: true } : { ok: false, reason: problems[0] };
}

/** The highest value a threshold can take with the current signers. */
export function maxSafeThreshold(signers: Signer[]): number {
  return Math.min(MAX_WEIGHT, totalWeight(signers));
}

/** Parse a weight/threshold field: an integer 0–255, or an error message. */
export function parseWeight(raw: string): { value: number } | { error: string } {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return { error: "Enter a whole number." };
  const value = Number(text);
  if (value > MAX_WEIGHT) return { error: `Must be ${MAX_WEIGHT} or less.` };
  return { value };
}
