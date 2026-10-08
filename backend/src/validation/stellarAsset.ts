import * as StellarSdk from "@stellar/stellar-sdk";

export const MAX_PATH_PAYMENT_HOPS = 5;

const ASSET_CODE_PATTERN = /^[a-zA-Z0-9]{1,12}$/;

export function isValidIssuedAsset(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const parts = value.split(":");
  if (parts.length !== 2) {
    return false;
  }

  const [code, issuer] = parts;
  return ASSET_CODE_PATTERN.test(code) && StellarSdk.StrKey.isValidEd25519PublicKey(issuer);
}

export function validatePathAssets(path: unknown): string[] {
  if (path === undefined) {
    return [];
  }

  if (!Array.isArray(path)) {
    throw new Error("path must be an array");
  }

  if (path.length > MAX_PATH_PAYMENT_HOPS) {
    throw new Error(`Path must contain at most ${MAX_PATH_PAYMENT_HOPS} assets`);
  }

  for (const asset of path) {
    if (!isValidIssuedAsset(asset)) {
      throw new Error("Each path asset must use the CODE:ISSUER format");
    }
  }

  return path as string[];
}
