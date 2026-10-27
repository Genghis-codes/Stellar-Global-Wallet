import { Pool } from "pg";
import {
  FeeBumpTransaction,
  Keypair,
  Transaction,
  TransactionBuilder,
  xdr as Xdr,
} from "@stellar/stellar-sdk";
import { AppError } from "../errors/appError";

/**
 * #74 — pending multisig transactions. One co-signer posts a transaction
 * that needs more signatures than they hold; the other signers fetch it,
 * sign it client-side and post their signed copy back. Signatures are
 * merged here, and once the collected weight reaches the account's
 * threshold the transaction is "ready" for any signer to submit.
 */

export type PendingTxStatus = "pending" | "ready" | "submitted" | "cancelled" | "expired";

export interface PendingTx {
  id: string;
  account: string;
  xdr: string;
  requiredWeight: number;
  collectedSigners: string[];
  createdBy: string;
  expiresAt: string | null;
  status: PendingTxStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AccountSigners {
  lowThreshold: number;
  mediumThreshold: number;
  highThreshold: number;
  signers: Array<{ key: string; weight: number }>;
}

/** Operations that need the account's high threshold (SEP-0001 / CAP-0006). */
const HIGH_THRESHOLD_OPS = new Set(["setOptions", "accountMerge"]);

export function parseClassicTransaction(xdr: string, networkPassphrase: string): Transaction {
  let tx: Transaction | FeeBumpTransaction;
  try {
    tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  } catch {
    throw new AppError("xdr is not a valid transaction envelope", { code: "INVALID_TRANSACTION", status: 400 });
  }
  if (tx instanceof FeeBumpTransaction) {
    throw new AppError("Fee-bump envelopes cannot be co-signed; share the inner transaction", {
      code: "INVALID_TRANSACTION",
      status: 400,
    });
  }
  return tx;
}

export function requiredWeightFor(tx: Transaction, account: AccountSigners): number {
  const high = tx.operations.some((op) => HIGH_THRESHOLD_OPS.has(op.type));
  // A threshold of 0 still needs one valid signature to be accepted.
  return Math.max(1, high ? account.highThreshold : account.mediumThreshold);
}

/** Account signers whose ed25519 key produced one of the tx's signatures. */
export function verifiedSigners(tx: Transaction, account: AccountSigners): string[] {
  const hash = tx.hash();
  const found: string[] = [];
  for (const signer of account.signers) {
    if (signer.weight <= 0 || !signer.key.startsWith("G")) continue;
    const kp = Keypair.fromPublicKey(signer.key);
    const hint = kp.signatureHint();
    const signed = tx.signatures.some(
      (sig) => sig.hint().equals(hint) && kp.verify(hash, sig.signature())
    );
    if (signed) found.push(signer.key);
  }
  return found;
}

export function weightOf(signers: string[], account: AccountSigners): number {
  return account.signers
    .filter((s) => signers.includes(s.key))
    .reduce((sum, s) => sum + s.weight, 0);
}

/** Add `incoming`'s signatures to `base` (same transaction hash required). */
export function mergeSignatures(base: Transaction, incoming: Transaction): Transaction {
  if (!base.hash().equals(incoming.hash())) {
    throw new AppError("Signed transaction does not match the pending transaction", {
      code: "INVALID_TRANSACTION",
      status: 409,
    });
  }
  const seen = new Set(base.signatures.map((s) => s.toXDR("base64")));
  for (const sig of incoming.signatures) {
    if (!seen.has(sig.toXDR("base64"))) {
      base.signatures.push(Xdr.DecoratedSignature.fromXDR(sig.toXDR()));
      seen.add(sig.toXDR("base64"));
    }
  }
  return base;
}

export function expiryOf(tx: Transaction): string | null {
  const max = Number(tx.timeBounds?.maxTime ?? 0);
  return max > 0 ? new Date(max * 1000).toISOString() : null;
}

export interface PendingTxStore {
  create(row: Omit<PendingTx, "id" | "createdAt" | "updatedAt">): Promise<PendingTx>;
  get(id: string): Promise<PendingTx | null>;
  listForAccount(account: string): Promise<PendingTx[]>;
  update(
    id: string,
    patch: Pick<PendingTx, "xdr" | "collectedSigners" | "status">
  ): Promise<PendingTx>;
}

interface PendingTxRow {
  id: string;
  account: string;
  xdr: string;
  required_weight: number;
  collected_signers: string[];
  created_by: string;
  expires_at: Date | null;
  status: PendingTxStatus;
  created_at: Date;
  updated_at: Date;
}

/** Postgres-backed store over the pending_txs table created in db.ts. */
export class PgPendingTxStore implements PendingTxStore {
  constructor(private readonly db: Pool) {}

  private toPendingTx(row: PendingTxRow): PendingTx {
    const expired =
      row.status === "pending" && row.expires_at !== null && row.expires_at.getTime() <= Date.now();
    return {
      id: String(row.id),
      account: row.account,
      xdr: row.xdr,
      requiredWeight: row.required_weight,
      collectedSigners: row.collected_signers,
      createdBy: row.created_by,
      expiresAt: row.expires_at?.toISOString() ?? null,
      status: expired ? "expired" : row.status,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async create(row: Omit<PendingTx, "id" | "createdAt" | "updatedAt">): Promise<PendingTx> {
    const { rows } = await this.db.query<PendingTxRow>(
      `INSERT INTO pending_txs (account, xdr, required_weight, collected_signers, created_by, expires_at, status)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
       RETURNING *`,
      [
        row.account,
        row.xdr,
        row.requiredWeight,
        JSON.stringify(row.collectedSigners),
        row.createdBy,
        row.expiresAt,
        row.status,
      ]
    );
    return this.toPendingTx(rows[0]);
  }

  async get(id: string): Promise<PendingTx | null> {
    if (!/^\d+$/.test(id)) return null;
    const { rows } = await this.db.query<PendingTxRow>("SELECT * FROM pending_txs WHERE id = $1", [id]);
    return rows[0] ? this.toPendingTx(rows[0]) : null;
  }

  async listForAccount(account: string): Promise<PendingTx[]> {
    const { rows } = await this.db.query<PendingTxRow>(
      `SELECT * FROM pending_txs
       WHERE account = $1 AND status IN ('pending', 'ready')
       ORDER BY created_at DESC
       LIMIT 100`,
      [account]
    );
    return rows.map((row) => this.toPendingTx(row));
  }

  async update(
    id: string,
    patch: Pick<PendingTx, "xdr" | "collectedSigners" | "status">
  ): Promise<PendingTx> {
    const { rows } = await this.db.query<PendingTxRow>(
      `UPDATE pending_txs
       SET xdr = $2, collected_signers = $3::jsonb, status = $4, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, patch.xdr, JSON.stringify(patch.collectedSigners), patch.status]
    );
    return this.toPendingTx(rows[0]);
  }
}
