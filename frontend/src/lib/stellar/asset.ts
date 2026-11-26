import type { HorizonBalanceLine } from "@/lib/api/endpoints/account";

/**
 * Asset identity as the backend uses it: "XLM" for the native asset and
 * "CODE:ISSUER" for issued assets (price routes, preferences.hiddenAssets).
 */
export interface AssetRef {
  code: string;
  /** Undefined for native XLM. */
  issuer?: string;
}

export const NATIVE: AssetRef = { code: "XLM" };

export function isNative(asset: AssetRef): boolean {
  return asset.issuer === undefined && asset.code === "XLM";
}

export function assetId(asset: AssetRef): string {
  return isNative(asset) || !asset.issuer ? "XLM" : `${asset.code}:${asset.issuer}`;
}

/** Parse "XLM", "native" or "CODE:ISSUER"; null when malformed. */
export function parseAssetId(id: string): AssetRef | null {
  const value = id.trim();
  if (value === "XLM" || value === "native") return NATIVE;
  const [code, issuer, ...rest] = value.split(":");
  if (rest.length > 0 || !code || !issuer) return null;
  if (!/^[a-zA-Z0-9]{1,12}$/.test(code) || !/^G[A-Z2-7]{55}$/.test(issuer)) return null;
  return { code, issuer };
}

/** The asset of a Horizon balance line; null for liquidity-pool shares. */
export function assetFromBalanceLine(line: HorizonBalanceLine): AssetRef | null {
  if (line.asset_type === "native") return NATIVE;
  if (line.asset_type === "liquidity_pool_shares" || !line.asset_code || !line.asset_issuer) return null;
  return { code: line.asset_code, issuer: line.asset_issuer };
}

/** Sort native first, then by code, then issuer. */
export function compareAssets(a: AssetRef, b: AssetRef): number {
  if (isNative(a) !== isNative(b)) return isNative(a) ? -1 : 1;
  return a.code.localeCompare(b.code) || (a.issuer ?? "").localeCompare(b.issuer ?? "");
}
