/**
 * Async transaction submission with polling and status tracking.
 *
 * Submits transactions to Horizon and polls for status until completion
 * or expiry. Exposes status via Redis for real-time updates (SSE).
 *
 * Status taxonomy:
 *   - SUBMITTING: Transaction has been submitted, waiting for first status
 *   - PENDING: Transaction is in the ledger but not confirmed
 *   - SUCCESS: Transaction successfully landed
 *   - EXPIRED: Transaction timeBounds have passed
 *   - FAILED: Transaction was rejected by Horizon with a result code
 *   - UNKNOWN: Submission timed out (504) - client must query later
 */

import { Pool } from "pg";
import { createClient, RedisClientType } from "redis";
import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "../config";
import { metrics } from "./metrics";
import { accountRequiresMemo } from "./transactionBuilder";

export type TransactionStatus = "submitting" | "pending" | "success" | "expired" | "failed" | "unknown";

export interface TransactionRecord {
  hash: string;
  accountId: string;
  status: TransactionStatus;
  ledger?: number;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
  resultCodes?: string;
  fee?: string;
  operationCount?: number;
}

export interface TransactionStore {
  create(record: Omit<TransactionRecord, "createdAt" | "updatedAt">): Promise<TransactionRecord>;
  get(hash: string): Promise<TransactionRecord | null>;
  update(hash: string, patch: Partial<TransactionRecord>): Promise<TransactionRecord>;
  listForAccount(accountId: string, limit?: number): Promise<TransactionRecord[]>;
}

interface TransactionRow {
  hash: string;
  account_id: string;
  status: string;
  ledger: number | null;
  created_at: Date;
  updated_at: Date;
  error_message: string | null;
  result_codes: string | null;
  fee: string | null;
  operation_count: number | null;
}

export class PgTransactionStore implements TransactionStore {
  constructor(private readonly db: Pool) {}

  async create(record: Omit<TransactionRecord, "createdAt" | "updatedAt">): Promise<TransactionRecord> {
    const { rows } = await this.db.query<TransactionRow>(
      `INSERT INTO transaction_status (hash, account_id, status, ledger, error_message, result_codes, fee, operation_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        record.hash,
        record.accountId,
        record.status,
        record.ledger,
        record.errorMessage,
        record.resultCodes,
        record.fee,
        record.operationCount,
      ]
    );
    return this.toRecord(rows[0]);
  }

  async get(hash: string): Promise<TransactionRecord | null> {
    const { rows } = await this.db.query<TransactionRow>("SELECT * FROM transaction_status WHERE hash = $1", [hash]);
    return rows[0] ? this.toRecord(rows[0]) : null;
  }

  async update(hash: string, patch: Partial<TransactionRecord>): Promise<TransactionRecord> {
    const set: string[] = [];
    const values: any[] = [hash];

    if (patch.status !== undefined) {
      set.push(`status = $${values.length + 1}`);
      values.push(patch.status);
    }
    if (patch.ledger !== undefined) {
      set.push(`ledger = $${values.length + 1}`);
      values.push(patch.ledger);
    }
    if (patch.errorMessage !== undefined) {
      set.push(`error_message = $${values.length + 1}`);
      values.push(patch.errorMessage);
    }
    if (patch.resultCodes !== undefined) {
      set.push(`result_codes = $${values.length + 1}`);
      values.push(patch.resultCodes);
    }
    if (patch.fee !== undefined) {
      set.push(`fee = $${values.length + 1}`);
      values.push(patch.fee);
    }
    if (patch.operationCount !== undefined) {
      set.push(`operation_count = $${values.length + 1}`);
      values.push(patch.operationCount);
    }

    const { rows } = await this.db.query<TransactionRow>(
      `UPDATE transaction_status SET ${set.join(", ")}, updated_at = NOW() WHERE hash = $1 RETURNING *`,
      values
    );
    return this.toRecord(rows[0]);
  }

  async listForAccount(accountId: string, limit: number = 20): Promise<TransactionRecord[]> {
    const { rows } = await this.db.query<TransactionRow>(
      `SELECT * FROM transaction_status WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [accountId, limit]
    );
    return rows.map((row) => this.toRecord(row));
  }

  private toRecord(row: TransactionRow): TransactionRecord {
    return {
      hash: row.hash,
      accountId: row.account_id,
      status: row.status as TransactionStatus,
      ledger: row.ledger ?? undefined,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      errorMessage: row.error_message ?? undefined,
      resultCodes: row.result_codes ?? undefined,
      fee: row.fee ?? undefined,
      operationCount: row.operation_count ?? undefined,
    };
  }
}

export class RedisTransactionPublisher implements TransactionPublisher {
  private client: RedisClientType | null = null;
  private channel: string;

  constructor(channel: string = "transaction-status") {
    this.channel = channel;
  }

  private getClient(): RedisClientType {
    if (!this.client) {
      this.client = createClient({ url: config.REDIS_URL });
      this.client.on("error", (err) => console.error("[transaction-status] redis error:", err.message));
    }
    return this.client;
  }

  async connect(): Promise<void> {
    const client = this.getClient();
    if (!client.isOpen) await client.connect();
  }

  async publish(hash: string, status: TransactionStatus, details?: { ledger?: number; errorMessage?: string }): Promise<void> {
    const client = this.getClient();
    if (!client.isOpen) await this.connect();

    const data = JSON.stringify({ hash, status, ...details });
    await client.publish(this.channel, data);
  }
}

/** Anything that can broadcast a status change (Redis in production, a no-op in dev). */
export interface TransactionPublisher {
  publish(hash: string, status: TransactionStatus, details?: { ledger?: number; errorMessage?: string }): Promise<void>;
}

export interface TransactionSubmitOptions {
  server: StellarSdk.Horizon.Server;
  store: TransactionStore;
  publisher?: TransactionPublisher;
  pollingIntervalMs?: number;
  pollingTimeoutMs?: number;
  maxRetries?: number;
}

export class TransactionSubmitter {
  private server: StellarSdk.Horizon.Server;
  private store: TransactionStore;
  private publisher?: TransactionPublisher;
  private pollingIntervalMs: number;
  private pollingTimeoutMs: number;
  private maxRetries: number;

  constructor(options: TransactionSubmitOptions) {
    this.server = options.server;
    this.store = options.store;
    this.publisher = options.publisher;
    this.pollingIntervalMs = options.pollingIntervalMs ?? 2000;
    this.pollingTimeoutMs = options.pollingTimeoutMs ?? 60_000;
    this.maxRetries = options.maxRetries ?? 3;
  }

  /**
   * Submit a transaction with polling for final status.
   */
  async submitWithStatus(tx: StellarSdk.Transaction): Promise<TransactionRecord> {
    const hash = Buffer.from(tx.hash()).toString("hex");
    const sourceAccount = tx.source;

    // Create initial record
    await this.store.create({
      hash,
      accountId: sourceAccount,
      status: "submitting" as TransactionStatus,
      ledger: undefined,
      errorMessage: undefined,
      resultCodes: undefined,
      fee: tx.fee,
      operationCount: tx.operations.length,
    });

    try {
      const result = await this.submitWithRetry(tx);
      
      // Update status based on result
      if (result.successful) {
        await this.updateStatus(hash, "success", { ledger: result.ledger });
        await this.publisher?.publish(hash, "success", { ledger: result.ledger });
        return await this.requireRecord(hash);
      } else {
        const error = new Error(`Transaction not successful: ${JSON.stringify(result)}`);
        throw error;
      }
    } catch (err: any) {
      const errorStatus = this.classifyError(err, hash);
      await this.updateStatus(hash, errorStatus, {
        errorMessage: err.message,
        resultCodes: this.getResultCodes(err),
      });
      await this.publisher?.publish(hash, errorStatus, { errorMessage: err.message });
      throw this.translateError(err, errorStatus);
    }
  }

  private async requireRecord(hash: string): Promise<TransactionRecord> {
    const record = await this.store.get(hash);
    if (!record) throw new Error(`Transaction record ${hash} disappeared from the store`);
    return record;
  }

  /**
   * Poll for transaction status by hash.
   */
  async pollStatus(hash: string, timeoutMs?: number): Promise<TransactionRecord> {
    const startTime = Date.now();
    const timeout = timeoutMs ?? this.pollingTimeoutMs;

    while (Date.now() - startTime < timeout) {
      const record = await this.store.get(hash);
      if (record && ["success", "expired", "failed", "unknown"].includes(record.status)) {
        return record;
      }

      // Try to fetch from Horizon
      try {
        const tx = await this.server.transactions().transaction(hash).call();
        const status = tx.successful ? "success" : "failed";
        await this.updateStatus(hash, status, {
          ledger: tx.ledger_attr,
          errorMessage: tx.successful ? undefined : "Transaction failed on chain",
        });
        await this.publisher?.publish(hash, status, { ledger: tx.ledger_attr });
        return await this.requireRecord(hash);
      } catch (err: any) {
        if (err.response?.status === 404) {
          // Not found yet, continue polling
        } else {
          // Other error, update to unknown
          await this.updateStatus(hash, "unknown", { errorMessage: err.message });
          throw err;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, this.pollingIntervalMs));
    }

    // Timeout reached
    await this.updateStatus(hash, "unknown", { errorMessage: "Polling timed out" });
    throw new Error("Transaction status timed out");
  }

  /**
   * Submit with retry logic for transient failures.
   */
  private async submitWithRetry(tx: StellarSdk.Transaction): Promise<any> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.server.submitTransaction(tx);
      } catch (err: any) {
        // Don't retry on 504 (gateway timeout) - that's what polling handles
        if (err.response?.status === 504) {
          throw err;
        }

        lastError = err;
        
        // Check if we should retry (e.g., rate limit exceeded)
        if (attempt < this.maxRetries && this.shouldRetry(err)) {
          const delay = Math.min(1000, 100 * Math.pow(2, attempt));
          console.log(`[transaction-status] Retry ${attempt + 1}/${this.maxRetries} after ${delay}ms`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          break;
        }
      }
    }

    throw lastError;
  }

  private shouldRetry(err: unknown): boolean {
    const errCode = (err as { code?: string })?.code;
    return errCode === "ECONNRESET" || errCode === "ETIMEDOUT" || errCode === "ECONNREFUSED";
  }

  private async updateStatus(hash: string, status: TransactionStatus, details?: { ledger?: number; errorMessage?: string; resultCodes?: string }): Promise<void> {
    const patch: Partial<TransactionRecord> = { status, ...details };
    await this.store.update(hash, patch);
  }

  private classifyError(err: unknown, hash: string): TransactionStatus {
    if ((err as { response?: { status?: number } })?.response?.status === 504) {
      return "unknown";
    }

    const resultCodes = this.getResultCodes(err);
    
    if (resultCodes?.includes("tx_too_late")) {
      return "expired";
    }
    
    if (resultCodes?.includes("tx_already_submitted")) {
      return "success";
    }

    if (resultCodes?.includes("tx_bad_seq")) {
      // Check if transaction actually landed
      return "pending"; // Will be resolved by polling
    }

    return "failed";
  }

  private getResultCodes(err: unknown): string | undefined {
    return (err as { response?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } })?.response?.extras?.result_codes?.transaction;
  }

  private translateError(err: unknown, status: TransactionStatus): unknown {
    // Already translated by caller, just re-throw
    if (err instanceof Error) {
      return err;
    }
    return new Error(`Transaction ${status}: ${(err as Error)?.message}`);
  }
}
