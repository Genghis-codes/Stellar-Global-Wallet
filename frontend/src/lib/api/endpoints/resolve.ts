import type { ApiClient } from "../client";

/**
 * /api/v1/resolve — turn a payment address into the account to pay
 * (backend/src/routes/resolve.ts, services/federation.ts). Accepts a G...
 * account, a muxed M... address or a SEP-2 federation address
 * (name*domain.com). Needs a session.
 */

export type ResolvedAddressType = "account" | "muxed" | "federation";

export interface ResolvedAddress {
  query?: string;
  type: ResolvedAddressType;
  /** Base G... account to pay. */
  accountId: string;
  /** Memo the federation server asks senders to attach (federation only). */
  memo?: string;
  memoType?: "text" | "id" | "hash";
  /** Muxed sub-account id as a decimal string (muxed only). */
  muxedId?: string;
  /** The M... address to use as the payment destination (muxed only). */
  muxedAddress?: string;
}

export function resolveApi(client: ApiClient) {
  return {
    /** GET /api/v1/resolve?q= */
    resolve(address: string, signal?: AbortSignal) {
      return client.get<ResolvedAddress>("/api/v1/resolve", { query: { q: address.trim() }, signal });
    },
  };
}

export type ResolveApi = ReturnType<typeof resolveApi>;
