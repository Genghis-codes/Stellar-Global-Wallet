/**
 * #287 — fee estimate accuracy tracking.
 *
 * In-process registry comparing the fee we estimated for a transaction with
 * the fee the network actually charged (classic `fee_charged` or the Soroban
 * resource fee). See docs/design/fee-estimate-accuracy.md.
 *
 * Amounts are stroop strings at the edge and BigInt internally so large
 * values never lose precision. Samples live in a bounded ring buffer.
 */

export type FeeKind = "classic" | "soroban";
export type FeeBand = "under" | "ok" | "over";

export interface FeeEstimateInput {
  hash: string;
  kind: FeeKind;
  estimatedFee: string;
  actualFee: string;
}

export interface FeeSample {
  hash: string;
  kind: FeeKind;
  estimated: string;
  actual: string;
  /** actual - estimated (negative = over-estimate), stroops. */
  error: string;
  /** actual / estimated (1.0 = perfect). */
  ratio: number;
  band: FeeBand;
  recordedAt: number;
}

export interface FeeAccuracySummary {
  count: number;
  bands: Record<FeeBand, number>;
  meanRatio: number | null;
}

/** A sample is `ok` when |ratio - 1| <= tolerance. */
export const DEFAULT_TOLERANCE = 0.1;
/** Target share of under-estimates before the margin is nudged up. */
export const TARGET_UNDER_RATE = 0.05;
export const MIN_MARGIN = 1.0;
export const MAX_MARGIN = 2.0;
const MAX_SAMPLES = 1000;

const samples: FeeSample[] = [];

function parseStroops(value: string): bigint | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

export function classifyRatio(ratio: number, tolerance = DEFAULT_TOLERANCE): FeeBand {
  if (Math.abs(ratio - 1) <= tolerance) return "ok";
  return ratio < 1 ? "over" : "under";
}

/**
 * Records one estimate/actual pair. Returns the stored sample, or null when
 * the input cannot be compared (non-numeric amounts or a zero estimate, which
 * would divide by zero).
 */
export function recordFeeEstimate(
  input: FeeEstimateInput,
  tolerance = DEFAULT_TOLERANCE
): FeeSample | null {
  const estimated = parseStroops(input.estimatedFee);
  const actual = parseStroops(input.actualFee);
  if (estimated === null || actual === null || estimated === 0n) return null;

  const ratio = Number(actual) / Number(estimated);
  const sample: FeeSample = {
    hash: input.hash,
    kind: input.kind,
    estimated: estimated.toString(),
    actual: actual.toString(),
    error: (actual - estimated).toString(),
    ratio,
    band: classifyRatio(ratio, tolerance),
    recordedAt: Date.now(),
  };
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  return sample;
}

export function getFeeSamples(kind?: FeeKind): FeeSample[] {
  return kind ? samples.filter((s) => s.kind === kind) : [...samples];
}

export function summarizeFeeAccuracy(kind?: FeeKind): FeeAccuracySummary {
  const list = getFeeSamples(kind);
  const bands: Record<FeeBand, number> = { under: 0, ok: 0, over: 0 };
  let ratioSum = 0;
  for (const s of list) {
    bands[s.band] += 1;
    ratioSum += s.ratio;
  }
  return {
    count: list.length,
    bands,
    meanRatio: list.length > 0 ? ratioSum / list.length : null,
  };
}

/**
 * Advisory fee multiplier derived from the observed under-estimate rate:
 * nudged up when under-estimates exceed the target, down when we only ever
 * over-estimate, clamped to [MIN_MARGIN, MAX_MARGIN]. Pure: never mutates
 * global state.
 */
export function recommendedMargin(currentMargin: number, kind?: FeeKind): number {
  const { count, bands } = summarizeFeeAccuracy(kind);
  let next = currentMargin;
  if (count > 0) {
    const underRate = bands.under / count;
    if (underRate > TARGET_UNDER_RATE) next = currentMargin * 1.1;
    else if (bands.over === count) next = currentMargin * 0.95;
  }
  return Math.min(MAX_MARGIN, Math.max(MIN_MARGIN, next));
}

/** Test helper. */
export function resetFeeAccuracy(): void {
  samples.length = 0;
}
