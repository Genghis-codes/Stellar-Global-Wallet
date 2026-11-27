import type { ApiClient } from "../client";
import type { AccountId } from "../types";

/**
 * /api/v1/pending-txs — shared, partially signed multisig transactions
 * (backend/src/routes/pendingTx.ts, #74). Every route needs a session, and
 * only signers of the transaction's source account can create, read or sign.
 * Signatures are verified server-side against the account's signer list.
 */

export type PendingTxStatus = "pending" | "ready" | "submitted" | "cancelled" | "expired";

/** A stored transaction plus the derived hash and collected weight. */
export interface PendingTx {
  id: string;
  /** Source account of the transaction. */
  account: AccountId;
  /** The envelope with every signature collected so far (base64). */
  xdr: string;
  /** Weight the transaction needs (the highest threshold its operations touch). */
  requiredWeight: number;
  /** Verified signer keys whose signatures are attached. */
  collectedSigners: string[];
  createdBy: AccountId;
  /** ISO time the transaction's time bounds run out; null when unbounded. */
  expiresAt: string | null;
  status: PendingTxStatus;
  createdAt: string;
  updatedAt: string;
  /** Hex transaction hash. */
  hash: string;
  collectedWeight: number;
}

export function pendingTxsApi(client: ApiClient) {
  const base = "/api/v1/pending-txs";
  return {
    /** Open transactions for an account the caller signs for. */
    async list(account: AccountId, signal?: AbortSignal): Promise<PendingTx[]> {
      const { items } = await client.get<{ items: PendingTx[] }>(base, { query: { account }, signal });
      return items;
    },

    get(id: string, signal?: AbortSignal) {
      return client.get<PendingTx>(`${base}/${encodeURIComponent(id)}`, { signal });
    },

    /** Share a (partially) signed classic transaction with the other signers. */
    create(xdr: string) {
      return client.post<PendingTx>(base, { xdr });
    },

    /** Merge the signatures of a signed copy into the stored transaction. */
    addSignatures(id: string, xdr: string) {
      return client.post<PendingTx>(`${base}/${encodeURIComponent(id)}/signatures`, { xdr });
    },

    /** Cancel (creator only). */
    cancel(id: string) {
      return client.delete<PendingTx>(`${base}/${encodeURIComponent(id)}`);
    },
  };
}

export type PendingTxsApi = ReturnType<typeof pendingTxsApi>;
