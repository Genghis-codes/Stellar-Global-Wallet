import type { Pool } from "pg";
import * as StellarSdk from "@stellar/stellar-sdk";
import { InvalidTransactionError } from "./stellarErrors";
import { metrics } from "./metrics";
import type { ParsedSignedTransaction } from "./transactionEnvelope";

/**
 * #194 — only relay transactions this API built.
 *
 * Every build endpoint records the hash of the unsigned transaction it
 * returned, with the intent (what the user asked for), source account,
 * sequence, network and expiry. `/wallet/submit` decodes the signed
 * envelope and refuses it unless its (inner) transaction hash matches a
 * recorded build. Signing doesn't change the hash, but any other edit
 * does — an extra operation, a different destination, a higher fee — so an
 * arbitrary signed transaction can't ride on this API's rate limits or fee
 * sponsorship. Fee-bump wrappers are fine: the inner transaction is what
 * gets matched.
 */

export type BuildIntentKind =
  | "payment"
  | "path-payment-strict-send"
  | "path-payment-strict-receive"
  | "trustline";

export interface BuildIntent {
  kind: BuildIntentKind;
  /** The request parameters that shaped the transaction, as strings. */
  params: Record<string, string>;
}

export interface BuiltTransactionRecord {
  /** Hex hash of the unsigned transaction. */
  hash: string;
  account: string;
  sequence: string;
  networkPassphrase: string;
  intent: BuildIntent;
  operationCount: number;
  /** ISO time of `timeBounds.maxTime`, or null if it never expires. */
  expiresAt: string | null;
  createdAt: string;
}

export interface BuiltTransactionStore {
  save(record: BuiltTransactionRecord): Promise<void>;
  get(hash: string): Promise<BuiltTransactionRecord | null>;
  /** Builds for the same source and sequence, used to explain a mismatch. */
  findBySequence(account: string, sequence: string): Promise<BuiltTransactionRecord[]>;
}

/** Records that no longer matter are dropped this long after they expire. */
const RETENTION_AFTER_EXPIRY_MS = 60 * 60 * 1000;

export class InMemoryBuiltTransactionStore implements BuiltTransactionStore {
  private readonly records = new Map<string, BuiltTransactionRecord>();

  async save(record: BuiltTransactionRecord): Promise<void> {
    this.prune();
    this.records.set(record.hash, record);
  }

  async get(hash: string): Promise<BuiltTransactionRecord | null> {
    return this.records.get(hash) ?? null;
  }

  async findBySequence(account: string, sequence: string): Promise<BuiltTransactionRecord[]> {
    return [...this.records.values()].filter((r) => r.account === account && r.sequence === sequence);
  }

  private prune(now = Date.now()): void {
    for (const [hash, r] of this.records) {
      if (r.expiresAt && Date.parse(r.expiresAt) + RETENTION_AFTER_EXPIRY_MS < now) this.records.delete(hash);
    }
  }
}

interface BuiltTransactionRow {
  hash: string;
  account: string;
  sequence: string;
  network_passphrase: string;
  intent: BuildIntent;
  operation_count: number;
  expires_at: Date | null;
  created_at: Date;
}

function fromRow(row: BuiltTransactionRow): BuiltTransactionRecord {
  return {
    hash: row.hash,
    account: row.account,
    sequence: String(row.sequence),
    networkPassphrase: row.network_passphrase,
    intent: row.intent,
    operationCount: row.operation_count,
    expiresAt: row.expires_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function ensureBuiltTransactionsTable(db: Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS built_transactions (
      hash VARCHAR(64) PRIMARY KEY,
      account VARCHAR(56) NOT NULL,
      sequence VARCHAR(20) NOT NULL,
      network_passphrase TEXT NOT NULL,
      intent JSONB NOT NULL,
      operation_count INTEGER NOT NULL,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS built_transactions_account_sequence_idx
      ON built_transactions (account, sequence)
  `);
}

export class PgBuiltTransactionStore implements BuiltTransactionStore {
  constructor(private readonly db: Pool) {}

  async save(r: BuiltTransactionRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO built_transactions
         (hash, account, sequence, network_passphrase, intent, operation_count, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       ON CONFLICT (hash) DO NOTHING`,
      [r.hash, r.account, r.sequence, r.networkPassphrase, JSON.stringify(r.intent), r.operationCount, r.expiresAt, r.createdAt]
    );
    // Cheap housekeeping: expired builds can't be submitted anyway.
    await this.db.query(
      `DELETE FROM built_transactions WHERE expires_at < NOW() - INTERVAL '1 hour'`
    );
  }

  async get(hash: string): Promise<BuiltTransactionRecord | null> {
    const { rows } = await this.db.query<BuiltTransactionRow>("SELECT * FROM built_transactions WHERE hash = $1", [hash]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async findBySequence(account: string, sequence: string): Promise<BuiltTransactionRecord[]> {
    const { rows } = await this.db.query<BuiltTransactionRow>(
      "SELECT * FROM built_transactions WHERE account = $1 AND sequence = $2 ORDER BY created_at DESC LIMIT 10",
      [account, sequence]
    );
    return rows.map(fromRow);
  }
}

function inner(tx: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction): StellarSdk.Transaction {
  return "innerTransaction" in tx ? tx.innerTransaction : tx;
}

function reject(reason: "NOT_BUILT_BY_API" | "ENVELOPE_MODIFIED" | "WRONG_NETWORK", message: string, extra?: Record<string, unknown>): never {
  metrics.submitRejected.inc({ reason });
  throw new InvalidTransactionError(message, reason, extra);
}

export class BuiltTransactionRegistry {
  constructor(
    private readonly store: BuiltTransactionStore,
    private readonly networkPassphrase: string
  ) {}

  /** Remember a transaction a build endpoint is about to return. */
  async record(tx: StellarSdk.Transaction, intent: BuildIntent): Promise<BuiltTransactionRecord> {
    const maxTime = tx.timeBounds?.maxTime ?? "0";
    const record: BuiltTransactionRecord = {
      hash: Buffer.from(tx.hash()).toString("hex"),
      account: tx.source,
      sequence: tx.sequence,
      networkPassphrase: this.networkPassphrase,
      intent,
      operationCount: tx.operations.length,
      expiresAt: maxTime === "0" ? null : new Date(Number(maxTime) * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    await this.store.save(record);
    return record;
  }

  /**
   * Refuse a signed envelope unless its transaction is exactly one this API
   * built, for this network. Expiry is checked by the caller
   * (`assertNotExpired`) so the error stays TX_EXPIRED.
   */
  async verify(parsed: ParsedSignedTransaction): Promise<BuiltTransactionRecord> {
    const tx = inner(parsed.transaction);
    const hash = Buffer.from(tx.hash()).toString("hex");
    const record = await this.store.get(hash);

    if (record) {
      if (record.networkPassphrase !== this.networkPassphrase) {
        reject("WRONG_NETWORK", "The transaction was built for a different network than the one this API uses.");
      }
      return record;
    }

    // Same source and sequence as a build of ours, different contents: the
    // envelope was edited after it left the API.
    const siblings = await this.store.findBySequence(tx.source, tx.sequence);
    if (siblings.length > 0) {
      const built = siblings[0];
      const differences: string[] = [];
      if (built.operationCount !== tx.operations.length) {
        differences.push(`operation count ${tx.operations.length}, built with ${built.operationCount}`);
      }
      reject(
        "ENVELOPE_MODIFIED",
        "The signed transaction does not match the one this API built. Sign the transaction exactly as " +
          "returned by the build endpoint, or build it again.",
        { intent: built.intent.kind, differences }
      );
    }

    reject(
      "NOT_BUILT_BY_API",
      "This API only submits transactions built by its own build endpoints. Build the transaction " +
        "with the API, sign it unchanged, and submit it before it expires."
    );
  }
}
