import { Pool } from "pg";
import { config } from "./config";
import { ensureDevicesTable } from "./services/deviceRegistry";
import { ensureVerifiedEmailsTable } from "./services/emailVerification";
import { ensurePreferencesTable } from "./routes/preferences";
import { ensureBuiltTransactionsTable } from "./services/builtTransactions";
import { ensureFeeSponsorshipTable } from "./services/feeSponsorship";
import { ensureActivityFeedTable } from "./services/activityFeed";
import { runMigrations } from "./migrations/runner";

const POOL_MAX_CLIENTS = config.NODE_ENV === "production" ? 20 : 10;
const SLOW_QUERY_THRESHOLD_MS = 200;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: POOL_MAX_CLIENTS,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("[postgres] Unexpected idle client error", err.message);
});

// Intercept queries for slow query logging (#219)
const originalQuery = pool.query.bind(pool);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
pool.query = (async (...args: any[]) => {
  const start = Date.now();
  try {
    // @ts-expect-error query overload forwarding
    return await originalQuery(...args);
  } finally {
    const duration = Date.now() - start;
    if (duration > SLOW_QUERY_THRESHOLD_MS) {
      const sql = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text ?? "";
      const snippet = sql.replace(/\s+/g, " ").trim().slice(0, 100);
      console.warn(`[postgres] SLOW QUERY (${duration}ms): ${snippet}`);
    }
  }
}) as typeof pool.query;

export async function ensureAuditTable() {
  // #219 — run managed migrations before legacy idempotent checks
  try {
    await runMigrations(pool, "up");
  } catch (err) {
    console.error("[migrations] Error executing migrations:", err);
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS keypair_audit_log (
      id BIGSERIAL PRIMARY KEY,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      api_key_hash VARCHAR(64) NOT NULL,
      public_key VARCHAR(56) NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source_public_key VARCHAR(56) NOT NULL,
      idempotency_key VARCHAR(255) NOT NULL,
      -- SHA-256 of the canonical request body; prevents key reuse across
      -- different payloads (#198 request fingerprint).
      request_fingerprint VARCHAR(64) NOT NULL DEFAULT '',
      result_hash VARCHAR(64) NOT NULL DEFAULT '',
      result_successful BOOLEAN NOT NULL DEFAULT false,
      -- false while the operation is in-flight; true once committed (#198).
      committed BOOLEAN NOT NULL DEFAULT false,
      UNIQUE (source_public_key, idempotency_key)
    )
  `);

  // Add new columns if they were missing from an earlier schema version.
  await pool.query(`
    ALTER TABLE idempotency_keys
      ADD COLUMN IF NOT EXISTS request_fingerprint VARCHAR(64) NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS committed BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS network VARCHAR(16) NOT NULL DEFAULT '${config.STELLAR_NETWORK}'
  `);

  // #87 — device token table for push notifications.
  await ensureDevicesTable(pool);

  // #90 — verified email table for email notification fallback.
  await ensureVerifiedEmailsTable(pool);

  // #74 — pending multisig transaction store for co-signers.
  await ensurePendingTxsTable(pool);

  // #37 — first-class session records for listing and revoke-all.
  await ensureSessionsTable(pool);

  // #68 — user preferences.
  await ensurePreferencesTable(pool);

  // #194 — hashes of transactions the build endpoints returned.
  await ensureBuiltTransactionsTable(pool);

  // #195 — per-user fee-sponsorship budget tracking.
  await ensureFeeSponsorshipTable(pool);

  // #79 — activity feed events and cursor table.
  await ensureActivityFeedTable();
}

export async function ensurePendingTxsTable(db: Pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS pending_txs (
      id BIGSERIAL PRIMARY KEY,
      account VARCHAR(56) NOT NULL,
      xdr TEXT NOT NULL,
      required_weight INTEGER NOT NULL,
      collected_signers JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by VARCHAR(56) NOT NULL,
      expires_at TIMESTAMPTZ,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      network VARCHAR(16) NOT NULL DEFAULT '${config.STELLAR_NETWORK}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    ALTER TABLE pending_txs
      ADD COLUMN IF NOT EXISTS network VARCHAR(16) NOT NULL DEFAULT '${config.STELLAR_NETWORK}'
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS pending_txs_account_status_idx
      ON pending_txs (account, status)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS pending_txs_expires_at_idx
      ON pending_txs (expires_at)
      WHERE status = 'pending'
  `);
}

export async function ensureSessionsTable(db: Pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY,
      account VARCHAR(56) NOT NULL,
      refresh_hash VARCHAR(64) NOT NULL,
      user_agent TEXT,
      ip_hash VARCHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS sessions_account_idx
      ON sessions (account)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS sessions_refresh_hash_idx
      ON sessions (refresh_hash)
  `);
}

/**
 * #261 — data retention and privacy.
 *
 * Data inventory (personal data stored by the backend):
 *   - verified_emails   : email address per account (email notification fallback)
 *   - devices           : push device tokens per account
 *   - preferences       : per-account user preferences
 *   - sessions          : refresh-token hashes, user agent, hashed IP
 *   - keypair_audit_log : api key hash + public key per key issuance
 *   - activity_feed     : per-account activity events
 *
 * Retention policy (defaults, overridable via env):
 *   - audit log entries older than AUDIT_LOG_RETENTION_DAYS are purged
 *   - revoked sessions older than SESSION_RETENTION_DAYS are purged
 *   - devices not seen within DEVICE_RETENTION_DAYS are purged
 *
 * Deletion removes every row keyed by the account across all of the above
 * tables so a user can exercise their right to erasure.
 */
const AUDIT_LOG_RETENTION_DAYS = Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? 90);
const SESSION_RETENTION_DAYS = Number(process.env.SESSION_RETENTION_DAYS ?? 30);
const DEVICE_RETENTION_DAYS = Number(process.env.DEVICE_RETENTION_DAYS ?? 180);

/** Tables that hold personal data keyed by an account column. */
const ACCOUNT_SCOPED_TABLES: ReadonlyArray<{ table: string; column: string }> = [
  { table: "verified_emails", column: "account" },
  { table: "devices", column: "account" },
  { table: "preferences", column: "account" },
  { table: "sessions", column: "account" },
  { table: "activity_feed", column: "account" },
];

/**
 * Purge personal data that has exceeded its retention window.
 * Returns the number of rows removed per table for observability.
 */
export async function runRetentionJobs(db: Pool = pool): Promise<Record<string, number>> {
  const removed: Record<string, number> = {};

  const audit = await db.query(
    `DELETE FROM keypair_audit_log
       WHERE issued_at < NOW() - ($1 || ' days')::interval`,
    [AUDIT_LOG_RETENTION_DAYS],
  );
  removed.keypair_audit_log = audit.rowCount ?? 0;

  const sessions = await db.query(
    `DELETE FROM sessions
       WHERE revoked_at IS NOT NULL
         AND revoked_at < NOW() - ($1 || ' days')::interval`,
    [SESSION_RETENTION_DAYS],
  );
  removed.sessions = sessions.rowCount ?? 0;

  const devices = await db.query(
    `DELETE FROM devices
       WHERE last_seen_at < NOW() - ($1 || ' days')::interval`,
    [DEVICE_RETENTION_DAYS],
  );
  removed.devices = devices.rowCount ?? 0;

  return removed;
}

/**
 * Export every stored personal-data row for an account so the user can
 * retrieve a copy of their data (GDPR/CCPA access request).
 */
export async function exportUserData(
  account: string,
  db: Pool = pool,
): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {};
  for (const { table, column } of ACCOUNT_SCOPED_TABLES) {
    const rows = await db.query(
      `SELECT * FROM ${table} WHERE ${column} = $1`,
      [account],
    );
    result[table] = rows.rows;
  }
  return result;
}

/**
 * Delete every stored personal-data row for an account (right to erasure).
 * Runs in a single transaction so a partial failure leaves no orphaned data.
 */
export async function deleteUserData(
  account: string,
  db: Pool = pool,
): Promise<Record<string, number>> {
  const client = await db.connect();
  const removed: Record<string, number> = {};
  try {
    await client.query("BEGIN");
    for (const { table, column } of ACCOUNT_SCOPED_TABLES) {
      const res = await client.query(
        `DELETE FROM ${table} WHERE ${column} = $1`,
        [account],
      );
      removed[table] = res.rowCount ?? 0;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return removed;
}
