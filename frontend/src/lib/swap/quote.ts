import type { PaymentPath } from "@/lib/api/endpoints/wallet";
import { fromStroops, toStroops } from "@/lib/stellar/amount";
import { bestPath, destinationAssetId, pathAssetIds, sourceAssetId } from "@/lib/stellar/paths";

/**
 * Pure helpers for the swap flow: a swap is a path payment from the account
 * to itself. Generic route helpers (asset ids, best path, rate) live in
 * lib/stellar/paths.ts; this adds the swap-specific pieces. Quotes come from POST /wallet/paths/strict-send|strict-receive
 * (Horizon path records); builds go to /wallet/path-payment-strict-*\/build.
 */

/** "send" = exact amount in (strict-send); "receive" = exact amount out (strict-receive). */
export type SwapMode = "send" | "receive";

/** Backend default and cap (backend/src/utils/slippage.ts). */
export const DEFAULT_SLIPPAGE_BPS = 50;
export const MAX_SLIPPAGE_BPS = 500;
export const SLIPPAGE_PRESETS_BPS = [10, 50, 100] as const;

const BPS = 10_000n;

/** Short label for an asset id ("USDC:G..." -> "USDC"). */
export function assetCodeOf(id: string): string {
  return id === "XLM" || id === "native" ? "XLM" : (id.split(":")[0] ?? id);
}

/** Every asset the route goes through, first to last, as codes. */
export function routeCodes(path: PaymentPath): string[] {
  return [sourceAssetId(path), ...pathAssetIds(path), destinationAssetId(path)].map(assetCodeOf);
}

/** The best quote for the swap's mode, ignoring records for other asset pairs. */
export function bestSwapPath(paths: PaymentPath[], mode: SwapMode, from: string, to: string): PaymentPath | null {
  return bestPath(paths, mode === "send" ? "strict-send" : "strict-receive", from, to);
}

/** Strict-send floor, rounded down to a stroop (never below one), as the backend computes it. */
export function minReceived(quoted: string, bps: number): string {
  const floored = (toStroops(quoted) * (BPS - BigInt(bps))) / BPS;
  return fromStroops(floored > 0n ? floored : 1n);
}

/** Strict-receive ceiling, rounded up to a stroop, as the backend computes it. */
export function maxSent(quoted: string, bps: number): string {
  const scaled = toStroops(quoted) * (BPS + BigInt(bps));
  return fromStroops((scaled + BPS - 1n) / BPS);
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(bps % 10 === 0 ? (bps % 100 === 0 ? 0 : 1) : 2)}%`;
}

/** Parse a user-typed percentage ("0.5") into basis points; null when invalid or above the cap. */
export function parseSlippagePercent(input: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(input.trim())) return null;
  const bps = Math.round(Number(input) * 100);
  return bps >= 0 && bps <= MAX_SLIPPAGE_BPS ? bps : null;
}
