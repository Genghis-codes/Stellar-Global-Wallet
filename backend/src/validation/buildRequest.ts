import * as StellarSdk from "@stellar/stellar-sdk";
import { isValidAccountId } from "./historyQuery";
import { isValidIssuedAsset } from "./stellarAsset";

/**
 * Validators shared by the unsigned-XDR build endpoints. Addresses are
 * checksum-validated (unlike `isGAddress`, which only checks prefix and
 * length), so a mistyped address is a 400 at the edge instead of an SDK
 * exception while building.
 */

/** A payment destination: a G... account or a muxed M... address. */
export function isValidDestination(value: unknown): boolean {
  return (
    isValidAccountId(value) ||
    (typeof value === "string" && StellarSdk.StrKey.isValidMed25519PublicKey(value))
  );
}

export const destinationOrMuxedMessage =
  "Invalid destination: must be a G... account or a muxed M... address.";

/** `XLM`, `native` or `CODE:ISSUER` — the same spellings `/send` accepts. */
export function isValidAssetParam(value: unknown): boolean {
  return value === "XLM" || value === "native" || isValidIssuedAsset(value);
}

export const assetParamMessage = 'asset must be "XLM", "native" or CODE:ISSUER';

/**
 * A claimable balance id: the 72-character hex encoding of a
 * `ClaimableBalanceId` (a 4-byte union discriminant followed by a 32-byte
 * hash). Accepts an optional `0x` prefix and is case-insensitive.
 */
export function isValidClaimableBalanceId(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const hex = value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
  return /^[0-9a-fA-F]{72}$/.test(hex);
}

export const claimableBalanceIdMessage =
  "Invalid balanceId: must be a 72-character hex claimable balance id.";

/**
 * An optional list of assets to convert/send before closing. Accepts either a
 * single asset string or an array of asset strings, each in the same spellings
 * `/send` accepts. `undefined` and `null` are treated as "not provided".
 */
export function isValidAssetList(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) {
    return value.every((entry) => isValidAssetParam(entry));
  }
  return isValidAssetParam(value);
}

export const assetListMessage =
  'assets must be a list of "XLM", "native" or CODE:ISSUER values';

/**
 * A boolean flag. Accepts real booleans and the strings `"true"`/`"false"`
 * (query strings and form bodies arrive as strings). `undefined` is allowed so
 * the flag can be omitted and defaulted by the route.
 */
export function isValidBooleanFlag(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "boolean") return true;
  return value === "true" || value === "false";
}

export const booleanFlagMessage = 'must be a boolean ("true" or "false")';

/** Coerce a validated boolean flag (or its string form) to a boolean. */
export function parseBooleanFlag(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/** Normalise a validated asset list into a de-duplicated array of strings. */
export function parseAssetList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return Array.from(new Set(list.filter((entry): entry is string => typeof entry === "string")));
}