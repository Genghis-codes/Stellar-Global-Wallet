import type { ApiClient } from "../client";

/**
 * /api/v1/assets — asset discovery for the add-trustline flow
 * (backend/src/routes/assets.ts). All public reads.
 */

/** GET /verified — one entry of the deployment's reviewed asset list. */
export interface VerifiedAsset {
  code: string;
  issuer: string;
  domain: string;
  name: string;
}

export interface VerifiedAssetsResponse {
  network: string;
  assets: VerifiedAsset[];
}

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type RiskFactor =
  | "unverified"
  | "same_code_different_issuer"
  | "homoglyph_domain"
  | "low_holders"
  | "very_new"
  | "unknown_domain";

/** One search hit (packages/types AssetSearchResult). Verified results sort first. */
export interface AssetSearchResult {
  code: string;
  issuer: string;
  homeDomain: string | null;
  numAccounts: number | null;
  verified: boolean;
  riskLevel: RiskLevel;
  riskFactors: RiskFactor[];
}

export interface AssetSearchPage {
  results: AssetSearchResult[];
  nextCursor: string | null;
}

/** Exactly one of `code` (paginated) or `domain` (stellar.toml, no cursor). */
export type AssetSearchQuery =
  | { code: string; limit?: number; cursor?: string }
  | { domain: string };

export type AssetMetadataStatus =
  | "ok"
  | "no_home_domain"
  | "invalid_home_domain"
  | "toml_unavailable"
  | "toml_invalid"
  | "currency_not_listed";

/** GET /:code/:issuer — display data from the issuer's stellar.toml. */
export interface AssetMetadata {
  code: string;
  issuer: string;
  name: string | null;
  desc: string | null;
  /** https-only image URL, or null. */
  image: string | null;
  decimals: number;
  homeDomain: string | null;
  orgName: string | null;
  status: AssetMetadataStatus;
}

export const MAX_ASSET_SEARCH_LIMIT = 50;

export function assetsApi(client: ApiClient) {
  return {
    verified(signal?: AbortSignal) {
      return client.get<VerifiedAssetsResponse>("/api/v1/assets/verified", { signal, auth: false });
    },

    search(query: AssetSearchQuery, signal?: AbortSignal) {
      const params =
        "domain" in query
          ? { domain: query.domain.trim().toLowerCase() }
          : { code: query.code.trim(), limit: query.limit, cursor: query.cursor };
      return client.get<AssetSearchPage>("/api/v1/assets/search", { query: params, signal, auth: false });
    },

    metadata(code: string, issuer: string, signal?: AbortSignal) {
      return client.get<AssetMetadata>(
        `/api/v1/assets/${encodeURIComponent(code)}/${encodeURIComponent(issuer)}`,
        { signal, auth: false },
      );
    },
  };
}

export type AssetsApi = ReturnType<typeof assetsApi>;
