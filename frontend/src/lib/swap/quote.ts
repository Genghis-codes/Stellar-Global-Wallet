import type { PaymentPath } from "@/lib/api/endpoints/wallet";
import { compareAmounts, fromStroops, toStroops } from "@/lib/stellar/amount";

/**
 * Pure helpers for the swap flow: a swap is a path payment from the account
 * to itself. Quotes come from POST /wallet/paths/strict-send|strict-receive
 * (Horizon path records); builds go to /wallet/path-payment-strict-*\/build.
 */

/** "send" = exact amount in (strict-send); "receive" = exact amount out (strict-receive). */
export type SwapMode = "send" | "receive";

/** Backend default and cap (backend/src/utils/slippage.ts). */
export const DEFAULT_SLIPPAGE_BPS = 50;
export const MAX_SLIPPAGE_BPS = 500;
export const SLIPPAGE_PRESETS_BPS = [10, 50, 100] as const;

const BPS = 10_000n;

type HorizonAssetType = PaymentPath["source_asset_type"];

/** Horizon asset fields -> the backend's asset id ("XLM" or "CODE:ISSUER"). */
export function horizonAssetId(type: HorizonAssetType, code?: string, issuer?: string): string {
  return type === "native" || !code || !issuer ? "XLM" : `${code}:${issuer}`;
}

/** Short label for an asset id ("USDC:G..." -> "USDC"). */
export function assetCodeOf(id: string): string {
  return id === "XLM" || id === "native" ? "XLM" : (id.split(":")[0] ?? id);
}

/** Intermediate hops of a path, in the form the build routes take. */
export function pathAssetIds(path: PaymentPath): string[] {
  return path.path.map((hop) => horizonAssetId(hop.asset_type, hop.asset_code, hop.asset_issuer));
}

/** Every asset the route goes through, first to last, as codes. */
export function routeCodes(path: PaymentPath): string[] {
  return [
    assetCodeOf(horizonAssetId(path.source_asset_type, path.source_asset_code, path.source_asset_issuer)),
    ...pathAssetIds(path).map(assetCodeOf),
    assetCodeOf(
      horizonAssetId(path.destination_asset_type, path.destination_asset_code, path.destination_asset_issuer),
    ),
  ];
}

/**
 * The best quote: for strict-send the path that delivers the most, for
 * strict-receive the one that costs the least. Null when there is no route.
 */
export function bestPath(paths: PaymentPath[], mode: SwapMode): PaymentPath | null {
  let best: PaymentPath | null = null;
  for (const candidate of paths) {
    if (!best) {
      best = candidate;
      continue;
    }
    const better =
      mode === "send"
        ? compareAmounts(candidate.destination_amount, best.destination_amount) > 0
        : compareAmounts(candidate.source_amount, best.source_amount) < 0;
    if (better) best = candidate;
  }
  return best;
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

/** Units of the received asset per one unit sent, to 7 decimals (rounded down). */
export function exchangeRate(sendAmount: string, receiveAmount: string): string | null {
  const send = toStroops(sendAmount);
  if (send === 0n) return null;
  return fromStroops((toStroops(receiveAmount) * 10_000_000n) / send);
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
