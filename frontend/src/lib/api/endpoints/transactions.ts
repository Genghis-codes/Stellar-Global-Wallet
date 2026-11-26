import type { ApiClient } from "../client";
import type { AccountId } from "../types";

/**
 * /api/v1/transactions — single transactions and submission status
 * (backend/src/routes/transactions.ts). `:hash` and `status/:hash` are public;
 * the per-account status feed needs a session for that account.
 */

/** An asset as the history/detail endpoints return it (packages/types AssetRef). */
export interface HistoryAsset {
  /** "XLM", "CODE:ISSUER" or "pool:<id>". */
  id: string;
  type: "native" | "credit_alphanum4" | "credit_alphanum12" | "liquidity_pool_shares";
  code: string;
  issuer: string | null;
}

export type HistoryItemType = "payment" | "swap" | "trustline" | "account_created" | "contract" | "other";
export type HistoryDirection = "in" | "out" | "self";

/** One decoded operation, from the viewing account's perspective (packages/types HistoryItem). */
export interface HistoryItem {
  id: string;
  pagingToken: string;
  type: HistoryItemType;
  /** Raw Horizon operation type, e.g. `path_payment_strict_send`. */
  operationType: string;
  direction: HistoryDirection;
  amount: string | null;
  asset: HistoryAsset | null;
  sourceAmount: string | null;
  sourceAsset: HistoryAsset | null;
  counterparty: string | null;
  /** Trustline ops: the new limit ("0.0000000" means removed). */
  trustlineLimit: string | null;
  contractFunction: string | null;
  memo: string | null;
  memoType: string | null;
  fee: string | null;
  feePayer: string | null;
  transactionHash: string;
  transactionOperationCount: number | null;
  createdAt: string;
  successful: boolean;
}

/** GET /:hash — the transaction with its decoded operations. */
export interface TransactionDetail {
  hash: string;
  ledger: number;
  createdAt: string;
  successful: boolean;
  sourceAccount: string;
  feeAccount: string;
  /** Fee charged, in XLM. */
  fee: string;
  /** Max fee the submitter allowed, in XLM. */
  maxFee: string;
  memo: string | null;
  memoType: string | null;
  operationCount: number;
  /** Account the operations' direction is relative to. */
  perspective: string;
  operations: HistoryItem[];
  explorerUrl: string | null;
}

/** backend/src/services/transactionStatus.ts TransactionStatus. */
export type SubmissionStatus = "submitting" | "pending" | "success" | "expired" | "failed" | "unknown";

/** GET /status/:hash and the account feed — the tracked submission record. */
export interface TransactionStatusRecord {
  hash: string;
  accountId: string;
  status: SubmissionStatus;
  ledger?: number;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
  resultCodes?: string;
  fee?: string;
  operationCount?: number;
}

/** Statuses that can still change, so the UI keeps polling. */
export function isInFlightStatus(status: SubmissionStatus): boolean {
  return status === "submitting" || status === "pending" || status === "unknown";
}

/** A 64-character hex transaction hash. */
export function isTransactionHash(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

export function transactionsApi(client: ApiClient) {
  return {
    /** GET /:hash — `account` sets whose perspective operations are described from. */
    get(hash: string, account?: AccountId, signal?: AbortSignal) {
      return client.get<TransactionDetail>(`/api/v1/transactions/${encodeURIComponent(hash.toLowerCase())}`, {
        query: { account },
        signal,
        auth: false,
      });
    },

    /** GET /status/:hash — async submission status (503 when tracking is off). */
    status(hash: string, signal?: AbortSignal) {
      return client.get<TransactionStatusRecord>(
        `/api/v1/transactions/status/${encodeURIComponent(hash.toLowerCase())}`,
        { signal, auth: false },
      );
    },

    /** GET /account/:accountId/statuses — recent submissions for the signed-in account. */
    async accountStatuses(accountId: AccountId, limit?: number, signal?: AbortSignal) {
      const { transactions } = await client.get<{ transactions: TransactionStatusRecord[] }>(
        `/api/v1/transactions/account/${encodeURIComponent(accountId)}/statuses`,
        { query: { limit }, signal },
      );
      return transactions;
    },
  };
}

export type TransactionsApi = ReturnType<typeof transactionsApi>;
