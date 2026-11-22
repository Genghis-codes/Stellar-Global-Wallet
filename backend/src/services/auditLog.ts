/**
 * Tamper-evident audit log (#202).
 *
 * Each row's `row_hash` is SHA-256(prev_hash || event_type || actor ||
 * subject || metadata_json || created_at_iso). The `prev_hash` of the first
 * row is the all-zeros sentinel. Any offline verifier can walk the chain and
 * re-derive every hash to detect deletions, re-ordering, or field edits.
 *
 * The chain covers ALL security-relevant events (keypair issuance, login,
 * logout, key rotation, fee-bump sponsorships, failed auth attempts) so the
 * log is useful beyond the original keypair-only scope.
 *
 * Data retention (#261): audit rows are personal data (actor = JWT subject).
 * `purgeExpiredAuditLog` anonymises rows older than the retention window by
 * replacing the actor with a non-identifying sentinel and clearing metadata,
 * while preserving the hash chain (the row_hash is recomputed and the chain
 * re-linked so `verifyAuditChain` still passes). `deleteAuditLogForActor`
 * removes all rows for a single actor for the user data-deletion endpoint.
 */

import { createHash } from "crypto";
import { pool } from "../db";

// ---------------------------------------------------------------------------
// DB bootstrap — called from db.ts ensureAuditTable()
// ---------------------------------------------------------------------------

export async function ensureAuditLogTable(): Promise<void> {
  // New general-purpose audit event log with hash chain.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      event_type VARCHAR(64) NOT NULL,
      -- JWT subject or "anonymous" / "system".
      actor VARCHAR(128) NOT NULL,
      -- Resource affected (Stellar account, kid, etc.). Empty string if N/A.
      subject VARCHAR(128) NOT NULL DEFAULT '',
      -- Free-form context. Stored as text, not jsonb, so the hash is over the
      -- exact bytes we stored and cannot silently change via jsonb normalisation.
      metadata TEXT NOT NULL DEFAULT '{}',
      -- SHA-256 of the previous row's row_hash (zeros for the first row).
      prev_hash VARCHAR(64) NOT NULL,
      -- SHA-256 of prev_hash||event_type||actor||subject||metadata||created_at.
      row_hash VARCHAR(64) NOT NULL
    )
  `);

  // Retain the legacy keypair_audit_log table for backward compat.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS keypair_audit_log (
      id BIGSERIAL PRIMARY KEY,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      api_key_hash VARCHAR(64) NOT NULL,
      public_key VARCHAR(56) NOT NULL
    )
  `);
}

// ---------------------------------------------------------------------------
// Chain helpers
// ---------------------------------------------------------------------------

const GENESIS_HASH = "0".repeat(64);

/** Sentinel actor used when an audit row is anonymised by retention. */
export const ANONYMISED_ACTOR = "anonymised";

/** Retrieve the row_hash of the most recent audit_log entry. */
async function lastRowHash(): Promise<string> {
  const { rows } = await pool.query<{ row_hash: string }>(
    `SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1`
  );
  return rows[0]?.row_hash ?? GENESIS_HASH;
}

function computeRowHash(
  prevHash: string,
  eventType: string,
  actor: string,
  subject: string,
  metadata: string,
  createdAt: string
): string {
  return createHash("sha256")
    .update(prevHash)
    .update(eventType)
    .update(actor)
    .update(subject)
    .update(metadata)
    .update(createdAt)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type AuditEventType =
  | "KEYPAIR_ISSUED"
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "TOKEN_ROTATED"
  | "SESSION_REVOKED"
  | "JWT_KEY_ROTATED"
  | "FEE_BUMP_SPONSORED"
  | "FEE_SPONSOR_DENIED"
  | "IDEMPOTENCY_CONFLICT";

export async function logAuditEvent(
  eventType: AuditEventType,
  actor: string,
  subject: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  // Serialise metadata deterministically so the hash is reproducible.
  const metaStr = JSON.stringify(metadata, Object.keys(metadata).sort());
  const createdAt = new Date().toISOString();
  const prevHash = await lastRowHash();
  const rowHash = computeRowHash(prevHash, eventType, actor, subject, metaStr, createdAt);

  await pool.query(
    `INSERT INTO audit_log
       (created_at, event_type, actor, subject, metadata, prev_hash, row_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [createdAt, eventType, actor, subject, metaStr, prevHash, rowHash]
  );
}

/**
 * Verify the integrity of the entire audit log chain.
 * Returns `{ valid: true }` or `{ valid: false, brokenAtId: number }`.
 *
 * This is an O(n) scan intended for periodic offline verification, not
 * for every request.
 */
export async function verifyAuditChain(): Promise<{ valid: boolean; brokenAtId?: number }> {
  const { rows } = await pool.query<{
    id: number;
    created_at: Date;
    event_type: string;
    actor: string;
    subject: string;
    metadata: string;
    prev_hash: string;
    row_hash: string;
  }>(`SELECT * FROM audit_log ORDER BY id ASC`);

  let expectedPrev = GENESIS_HASH;
  for (const row of rows) {
    const expected = computeRowHash(
      row.prev_hash,
      row.event_type,
      row.actor,
      row.subject,
      row.metadata,
      new Date(row.created_at).toISOString()
    );
    if (row.prev_hash !== expectedPrev || row.row_hash !== expected) {
      return { valid: false, brokenAtId: row.id };
    }
    expectedPrev = row.row_hash;
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Retention & deletion (#261)
// ---------------------------------------------------------------------------

/**
 * Anonymise audit rows older than `retentionDays`.
 *
 * Personal identifiers (actor, subject, metadata) are replaced with
 * non-identifying values. The hash chain is preserved by recomputing each
 * affected row's `row_hash` and re-linking subsequent `prev_hash` values so
 * `verifyAuditChain` continues to pass. Returns the number of rows anonymised.
 */
export async function purgeExpiredAuditLog(retentionDays: number): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    throw new Error("retentionDays must be a positive number");
  }

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const { rows } = await pool.query<{
    id: number;
    created_at: Date;
    event_type: string;
    actor: string;
    subject: string;
    metadata: string;
    prev_hash: string;
    row_hash: string;
  }>(`SELECT * FROM audit_log ORDER BY id ASC`);

  let expectedPrev = GENESIS_HASH;
  let anonymised = 0;

  for (const row of rows) {
    const createdAt = new Date(row.created_at).toISOString();
    const expired = createdAt < cutoff;
    const actor = expired ? ANONYMISED_ACTOR : row.actor;
    const subject = expired ? "" : row.subject;
    const metadata = expired ? "{}" : row.metadata;
    const rowHash = computeRowHash(expectedPrev, row.event_type, actor, subject, metadata, createdAt);

    if (expired && (row.actor !== actor || row.subject !== subject || row.metadata !== metadata)) {
      await pool.query(
        `UPDATE audit_log
           SET actor = $1, subject = $2, metadata = $3, prev_hash = $4, row_hash = $5
         WHERE id = $6`,
        [actor, subject, metadata, expectedPrev, rowHash, row.id]
      );
      anonymised += 1;
    } else if (row.prev_hash !== expectedPrev || row.row_hash !== rowHash) {
      // Re-link rows whose predecessor was rewritten by this pass.
      await pool.query(
        `UPDATE audit_log SET prev_hash = $1, row_hash = $2 WHERE id = $3`,
        [expectedPrev, rowHash, row.id]
      );
    }

    expectedPrev = rowHash;
  }

  return anonymised;
}

/**
 * Remove every audit row belonging to a single actor. Used by the user
 * data-deletion endpoint. Returns the number of rows removed.
 */
export async function deleteAuditLogForActor(actor: string): Promise<number> {
  const { rowCount } = await pool.query(`DELETE FROM audit_log WHERE actor = $1`, [actor]);
  return rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Legacy shim — keep existing callers working unchanged
// ---------------------------------------------------------------------------

export async function logKeypairIssuance(
  apiKey: string,
  publicKey: string
): Promise<void> {
  const hash = createHash("sha256").update(apiKey).digest("hex");
  // Write to the legacy table for backward compat.
  await pool.query(
    `INSERT INTO keypair_audit_log (api_key_hash, public_key) VALUES ($1, $2)`,
    [hash, publicKey]
  );
  // Also write a tamper-evident entry to the new chain.
  await logAuditEvent("KEYPAIR_ISSUED", apiKey, publicKey, { apiKeyHash: hash });
}
