import type { Horizon } from "@stellar/stellar-sdk";
import { LockoutError } from "../errors/appError";

/** Signer weights and thresholds are single bytes on Stellar. */
export const MAX_WEIGHT = 255;

export function isValidWeight(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_WEIGHT;
}

export interface SetOptionsInput {
  sourcePublicKey: string;
  addSigners?: Array<{ key: string; weight: number }>;
  removeSigners?: string[];
  masterWeight?: number;
  lowThreshold?: number;
  mediumThreshold?: number;
  highThreshold?: number;
}

export interface Thresholds {
  low: number;
  medium: number;
  high: number;
}

export interface SetOptionsResult {
  xdr: string;
  networkPassphrase: string;
  warnings: string[];
  resultingSigners: Array<{ key: string; weight: number }>;
  resultingThresholds: Thresholds;
}

export interface SetOptionsSimulation {
  signers: Array<{ key: string; weight: number }>;
  thresholds: Thresholds;
  warnings: string[];
}

type AccountLike = Pick<Horizon.AccountResponse, "account_id" | "signers" | "thresholds">;

/**
 * Apply a setOptions change to the account's current signers and
 * thresholds without touching the network, and refuse (LockoutError, 422)
 * any change that would leave the account unable to reach one of its own
 * thresholds: the result would be an account no one can ever change again.
 * Softer risks come back as warnings for the UI to confirm.
 */
export function simulateSetOptions(account: AccountLike, input: SetOptionsInput): SetOptionsSimulation {
  const weights = new Map<string, number>();
  for (const signer of account.signers) {
    if (signer.type === "ed25519_public_key" || signer.key.startsWith("G")) {
      weights.set(signer.key, signer.weight);
    }
  }

  if (input.masterWeight !== undefined) weights.set(account.account_id, input.masterWeight);
  for (const signer of input.addSigners ?? []) weights.set(signer.key, signer.weight);
  for (const key of input.removeSigners ?? []) {
    // The master key can't be removed, only weighted to 0 via masterWeight.
    if (key !== account.account_id) weights.delete(key);
  }

  const thresholds: Thresholds = {
    low: input.lowThreshold ?? account.thresholds.low_threshold,
    medium: input.mediumThreshold ?? account.thresholds.med_threshold,
    high: input.highThreshold ?? account.thresholds.high_threshold,
  };

  const signers = [...weights]
    .filter(([, weight]) => weight > 0)
    .map(([key, weight]) => ({ key, weight }));
  const total = signers.reduce((sum, s) => sum + s.weight, 0);

  const problems: string[] = [];
  if (total === 0) problems.push("no signer would have any weight");
  for (const [name, value] of Object.entries(thresholds)) {
    if (value > total) {
      problems.push(`${name} threshold ${value} exceeds the combined signer weight ${total}`);
    }
  }
  if (problems.length > 0) {
    throw new LockoutError("This change would lock the account out", problems, {
      resultingSigners: signers,
      resultingThresholds: thresholds,
    });
  }

  const warnings: string[] = [];
  const heaviest = Math.max(...signers.map((s) => s.weight));
  if (heaviest >= thresholds.high && signers.length > 1) {
    warnings.push("A single signer can still authorise high-threshold changes on its own.");
  }
  if ((weights.get(account.account_id) ?? 0) === 0) {
    warnings.push("The master key will have no weight; only the other signers can act for this account.");
  }
  for (const signer of signers) {
    if (total - signer.weight < thresholds.high) {
      warnings.push(`Losing ${signer.key} would leave the account unable to meet its high threshold.`);
    }
  }

  return { signers, thresholds, warnings };
}
