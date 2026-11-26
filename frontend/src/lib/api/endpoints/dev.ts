import type { ApiClient } from "../client";

/**
 * /api/v1/dev — testnet-only helpers (backend/src/routes/dev.ts, #69). The
 * router is mounted only when the backend runs on testnet; elsewhere these
 * calls 404.
 */
export interface FundResponse {
  account: string;
  funded: true;
  /** The account already existed; nothing was sent. */
  alreadyFunded: boolean;
}

export function devApi(client: ApiClient) {
  return {
    /** POST /api/v1/dev/fund — fund an account with Friendbot (safe to call twice). */
    fund(account: string) {
      return client.post<FundResponse>("/api/v1/dev/fund", { account }, { auth: false, timeoutMs: 30_000 });
    },
  };
}

export type DevApi = ReturnType<typeof devApi>;
