import type { PaymentPath, PathAssetHop } from "@/lib/api/endpoints/wallet";
import { STROOPS_PER_UNIT, compareAmounts, fromStroops, toStroops } from "./amount";

/** Path-finding results (Horizon records relayed by /wallet/paths/*) to backend asset ids. */

export function hopAssetId(hop: PathAssetHop): string {
  return hop.asset_type === "native" || !hop.asset_code || !hop.asset_issuer ? "XLM" : `${hop.asset_code}:${hop.asset_issuer}`;
}

export function sourceAssetId(path: PaymentPath): string {
  return hopAssetId({ asset_type: path.source_asset_type, asset_code: path.source_asset_code, asset_issuer: path.source_asset_issuer });
}

export function destinationAssetId(path: PaymentPath): string {
  return hopAssetId({
    asset_type: path.destination_asset_type,
    asset_code: path.destination_asset_code,
    asset_issuer: path.destination_asset_issuer,
  });
}

/** Intermediate hops as "CODE:ISSUER"/"XLM" ids, the format the build routes take. */
export function pathAssetIds(path: PaymentPath): string[] {
  return path.path.map(hopAssetId);
}

/**
 * Best route between two assets: the most received for strict-send, the
 * least spent for strict-receive. Records for other assets are ignored.
 */
export function bestPath(
  paths: PaymentPath[],
  mode: "strict-send" | "strict-receive",
  sendAsset: string,
  destAsset: string,
): PaymentPath | null {
  const matching = paths.filter((path) => sourceAssetId(path) === sendAsset && destinationAssetId(path) === destAsset);
  return matching.reduce<PaymentPath | null>((best, path) => {
    if (!best) return path;
    return mode === "strict-send"
      ? compareAmounts(path.destination_amount, best.destination_amount) > 0
        ? path
        : best
      : compareAmounts(path.source_amount, best.source_amount) < 0
        ? path
        : best;
  }, null);
}

/** Units of the destination asset per unit of the source, truncated to 7 decimals. */
export function exchangeRate(path: PaymentPath): string {
  const send = toStroops(path.source_amount);
  if (send === 0n) return "0";
  return fromStroops((toStroops(path.destination_amount) * STROOPS_PER_UNIT) / send);
}
