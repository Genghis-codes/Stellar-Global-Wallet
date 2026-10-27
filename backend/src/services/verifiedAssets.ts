/**
 * Curated list of verified issued assets (issues #53, #54).
 *
 * "Verified" means this deployment vouches that CODE:ISSUER is the asset
 * users almost certainly mean when they type CODE — e.g. Circle's USDC
 * rather than one of the many lookalike `USDC` issuers on the network.
 * It is not a statement about the asset's value or safety.
 *
 * The reviewed list lives in data/verified-assets.<network>.json (see
 * docs/verified-assets.md). Operators extend it per environment with
 * `VERIFIED_ASSETS` (comma-separated CODE:ISSUER),
 * the same variable the activity feed's `unknown_asset` flag reads, so both
 * features always agree on what "verified" means.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StrKey } from "@stellar/stellar-sdk";
import { config } from "../config";
import { assetKey, parseVerifiedAssetsList } from "./paymentFlags";

export interface CuratedAsset {
  code: string;
  issuer: string;
}

/** One reviewed entry in data/verified-assets.<network>.json (#54). */
export interface VerifiedAsset extends CuratedAsset {
  domain: string;
  name: string;
  /** Enables CoinGecko pricing for this asset (#55). */
  coingeckoId?: string;
  /** The DEX USD quote asset; at most one per network (#55). */
  usdPeg?: boolean;
}

const REQUIRED_FIELDS = ["code", "issuer", "domain", "name"] as const;
const ALLOWED_FIELDS = new Set<string>([...REQUIRED_FIELDS, "coingeckoId", "usdPeg"]);
const ASSET_CODE = /^[A-Za-z0-9]{1,12}$/;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

/**
 * Parse and strictly validate a verified-asset file. Anything suspicious
 * (unknown field, bad code/domain, issuer failing the StrKey checksum,
 * duplicate, two usdPeg entries, network mismatch) throws, so the API
 * refuses to boot instead of serving a partly-trusted list.
 */
export function parseVerifiedAssetFile(raw: unknown, network: string, source = "verified-assets"): VerifiedAsset[] {
  const fail = (msg: string): never => {
    throw new Error(`${source}: ${msg}`);
  };
  if (typeof raw !== "object" || raw === null) fail("must be a JSON object");
  const file = raw as { network?: unknown; assets?: unknown };
  if (file.network !== network) fail(`network is ${String(file.network)}, expected ${network}`);
  if (!Array.isArray(file.assets)) fail("assets must be an array");

  const seen = new Set<string>();
  let pegs = 0;
  return (file.assets as unknown[]).map((entry, i) => {
    const where = `assets[${i}]`;
    if (typeof entry !== "object" || entry === null) fail(`${where} must be an object`);
    const asset = entry as Record<string, unknown>;
    for (const key of Object.keys(asset)) {
      if (!ALLOWED_FIELDS.has(key)) fail(`${where} has unknown field "${key}"`);
    }
    for (const key of REQUIRED_FIELDS) {
      if (typeof asset[key] !== "string" || asset[key] === "") fail(`${where}.${key} is required`);
    }
    const code = asset.code as string;
    const issuer = asset.issuer as string;
    if (!ASSET_CODE.test(code)) fail(`${where}.code "${code}" is not a valid asset code`);
    if (!StrKey.isValidEd25519PublicKey(issuer)) fail(`${where}.issuer is not a valid G... address`);
    if (!DOMAIN.test(asset.domain as string)) fail(`${where}.domain is not a valid domain`);
    if (asset.coingeckoId !== undefined && typeof asset.coingeckoId !== "string") {
      fail(`${where}.coingeckoId must be a string`);
    }
    if (asset.usdPeg !== undefined && typeof asset.usdPeg !== "boolean") fail(`${where}.usdPeg must be a boolean`);
    if (asset.usdPeg === true && ++pegs > 1) fail("at most one asset may set usdPeg");
    const key = assetKey(code, issuer);
    if (seen.has(key)) fail(`${where} duplicates ${key}`);
    seen.add(key);
    return asset as unknown as VerifiedAsset;
  });
}

let cached: VerifiedAsset[] | undefined;

/** The verified-asset list for STELLAR_NETWORK, loaded and validated once. */
export function getVerifiedAssets(): VerifiedAsset[] {
  if (!cached) {
    const path = join(__dirname, "..", "..", "data", `verified-assets.${config.STELLAR_NETWORK}.json`);
    cached = parseVerifiedAssetFile(JSON.parse(readFileSync(path, "utf8")), config.STELLAR_NETWORK, path);
  }
  return cached;
}

export function findVerifiedAsset(code: string, issuer: string): VerifiedAsset | undefined {
  return getVerifiedAssets().find((a) => a.code === code && a.issuer === issuer);
}

export class VerifiedAssetRegistry {
  private readonly keys: ReadonlySet<string>;

  constructor(curated: CuratedAsset[], extraKeys: ReadonlySet<string>) {
    this.keys = new Set([...curated.map((a) => assetKey(a.code, a.issuer)), ...extraKeys]);
  }

  isVerified(code: string, issuer: string): boolean {
    return this.keys.has(assetKey(code, issuer));
  }

  /** Every verified CODE:ISSUER pair for `code` (case-sensitive, as on-chain). */
  issuersForCode(code: string): string[] {
    const prefix = `${code}:`;
    return [...this.keys].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  }
}

/** Reviewed list for this network plus any VERIFIED_ASSETS extras. */
export function createVerifiedAssetRegistry(): VerifiedAssetRegistry {
  return new VerifiedAssetRegistry(getVerifiedAssets(), parseVerifiedAssetsList(config.VERIFIED_ASSETS));
}
