import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { config } from "./config";
import {
  getCurrentRlsContext,
  RlsExecutionContext,
  rlsStorage,
  runWithRequestAccount,
} from "./rlsContext";
import { ensureDevicesTable } from "./services/deviceRegistry";
import { ensureVerifiedEmailsTable } from "./services/emailVerification";
import { ensurePreferencesTable } from "./routes/preferences";
import { ensureBuiltTransactionsTable } from "./services/builtTransactions";
import { ensureFeeSponsorshipTable } from "./services/feeSponsorship";
import { ensureActivityFeedTable } from "./services/activityFeed";
import { runMigrations } from "./migrations/runner";

const POOL_MAX_CLIENTS = config.NODE_ENV === "production" ? 20 : 10;
const SLOW_QUERY_THRESHOLD_MS = 200;

export { getCurrentRlsContext, RlsExecutionContext, runWithRequestAccount };

/**
 * Minimal query interface shared by `pg.Pool`, `pg.PoolClient`, and lightweight
 * test doubles. Services accept `Queryable` so callers can pass either the
 * ambient pool or an explicit RLS-scoped transaction client.
 */
export interface Queryable {
  query<R extends QueryResultRow = any>(
    queryTextOrConfig: string,
    values?: any[]
  ): Promise<QueryResult<R>>;
}

export interface TransactionalPool extends Queryable {
  connect?: () => Promise<PoolClient>;
}

/**
 * Canonical registry of every user-scoped Postgres table protected by
 * Row-Level Security (#282) and the column holding the owning Stellar account.
 */
export const USER_SCOPED_RLS_TABLES = [
  { table: "devices", ownerColumn: "account" },
  { table: "verified_emails", ownerColumn: "account" },
  { table: "user_preferences", ownerColumn: "account" },
  { table: "sessions", ownerColumn: "account" },
  { table: "idempotency_keys", ownerColumn: "source_public_key" },
  { table: "pending_txs", ownerColumn: "account" },
] as const;

export type UserScopedTableName = (typeof USER_SCOPED_RLS_TABLES)[number]["table"];

export const RLS_APP_ROLE = "globe_wallet_app";
export const RLS_SERVICE_ROLE = "globe_wallet_service";

const roleSupportCache = new WeakMap<object, Map<string, boolean>>();

/** Underlying `pg.Pool` used for schema bootstrap and client checkout. */
export const rawPool = new Pool({
  connectionString: config.DATABASE_URL,
  max: POOL_MAX_CLIENTS,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

rawPool.on("error", (err) => {
  console.error("[postgres] Unexpected idle client error", err.message);
});

// Intercept queries for slow query logging (#219)
const originalRawQuery = rawPool.query.bind(rawPool);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
rawPool.query = (async (...args: any[]) => {
  const start = Date.now();
  try {
    // @ts-expect-error query overload forwarding
    return await originalRawQuery(...args);
  } finally {
    const duration = Date.now() - start;
    if (duration > SLOW_QUERY_THRESHOLD_MS) {
      const sql = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text ?? "";
      const snippet = sql.replace(/\s+/g, " ").trim().slice(0, 100);
      console.warn(`[postgres] SLOW QUERY (${duration}ms): ${snippet}`);
    }
  }
}) as typeof rawPool.query;

function isConnectionPool(
  db: TransactionalPool
): db is TransactionalPool & { connect: () => Promise<PoolClient> } {
  // In `pg`, an already checked-out `PoolClient` inherits `Client.prototype.connect`
  // AND exposes `release()`. Only a pool (no `release` method) can check out a new client.
  return (
    typeof db.connect === "function" &&
    typeof (db as { release?: unknown }).release !== "function"
  );
}

function invalidateRoleCache(db: object): void {
  roleSupportCache.delete(db);
}

async function isDbRoleAvailable(
  db: object,
  client: Queryable,
  roleName: string
): Promise<boolean> {
  let perDb = roleSupportCache.get(db);
  if (!perDb) {
    perDb = new Map<string, boolean>();
    roleSupportCache.set(db, perDb);
  }
  const cached = perDb.get(roleName);
  if (cached !== undefined) return cached;

  try {
    const res = await client.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists",
      [roleName]
    );
    const exists = Boolean(res?.rows?.[0]?.exists);
    perDb.set(roleName, exists);
    return exists;
  } catch {
    perDb.set(roleName, false);
    return false;
  }
}

async function applyLocalRoleIfAvailable(
  db: object,
  client: Queryable,
  roleName: typeof RLS_APP_ROLE | typeof RLS_SERVICE_ROLE
): Promise<void> {
  if (await isDbRoleAvailable(db, client, roleName)) {
    // Role names are compile-time constants above (never user input).
    await client.query(`SET LOCAL ROLE ${roleName}`);
  }
}

/**
 * Runs `fn` inside a Postgres transaction scoped to `account` via
 * transaction-local settings (`set_config('app.account', $1, true)` — the
 * parameterized equivalent of `SET LOCAL app.account = ...`).
 *
 * Settings and `SET LOCAL ROLE globe_wallet_app` automatically revert on
 * `COMMIT` or `ROLLBACK` before the connection returns to the pool.
 */
export async function withAccountContext<T>(
  account: string,
  fn: (client: Queryable) => Promise<T>,
  db: TransactionalPool = rawPool
): Promise<T> {
  if (!account || typeof account !== "string" || account.trim().length === 0) {
    throw new Error("withAccountContext requires a non-empty account identifier");
  }

  const active = rlsStorage.getStore();
  if (
    active?.client &&
    (active.poolRef === db || active.client === db) &&
    active.mode === "account" &&
    active.account === account
  ) {
    return fn(active.client);
  }

  if (!isConnectionPool(db)) {
    return rlsStorage.run(
      { mode: "account", account, client: db, poolRef: db },
      () => fn(db)
    );
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await applyLocalRoleIfAvailable(db, client, RLS_APP_ROLE);
    await client.query(
      "SELECT set_config('app.role', 'authenticated', true), set_config('app.account', $1, true)",
      [account]
    );
    const result = await rlsStorage.run(
      { mode: "account", account, client, poolRef: db },
      () => fn(client)
    );
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Runs `fn` inside a Postgres transaction under the explicit background-job
 * service context (`app.role = 'service'`, `SET LOCAL ROLE globe_wallet_service`).
 *
 * Reserve strictly for non-request background workers (e.g. `paymentNotifier`,
 * `recoveryNotifier`) and pre-authorization lookups that verify on-chain
 * signer membership before returning data.
 */
export async function withServiceRole<T>(
  fn: (client: Queryable) => Promise<T>,
  options?: { jobName?: string; db?: TransactionalPool }
): Promise<T> {
  const db = options?.db ?? rawPool;
  const active = rlsStorage.getStore();
  if (
    active?.client &&
    (active.poolRef === db || active.client === db) &&
    active.mode === "service"
  ) {
    return fn(active.client);
  }

  if (!isConnectionPool(db)) {
    return rlsStorage.run(
      { mode: "service", jobName: options?.jobName, client: db, poolRef: db },
      () => fn(db)
    );
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await applyLocalRoleIfAvailable(db, client, RLS_SERVICE_ROLE);
    await client.query(
      "SELECT set_config('app.role', 'service', true), set_config('app.account', '', true)"
    );
    const result = await rlsStorage.run(
      { mode: "service", jobName: options?.jobName, client, poolRef: db },
      () => fn(client)
    );
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Executes an unscoped query inside a clean transaction with `app.account` and
 * `app.role` cleared and `SET LOCAL ROLE globe_wallet_app` applied (when
 * available), ensuring unscoped reads/writes against user-scoped tables never
 * bypass RLS even if `DATABASE_URL` connects as table owner or superuser.
 */
async function executeUnscopedQuery<R extends QueryResultRow = any>(
  targetPool: TransactionalPool,
  queryText: string,
  values?: any[]
): Promise<QueryResult<R>> {
  if (!isConnectionPool(targetPool)) {
    return targetPool.query<R>(queryText, values);
  }

  const client = await targetPool.connect();
  try {
    await client.query("BEGIN");
    await applyLocalRoleIfAvailable(targetPool, client, RLS_APP_ROLE);
    await client.query(
      "SELECT set_config('app.role', '', true), set_config('app.account', '', true)"
    );
    const res = await client.query<R>(queryText, values);
    await client.query("COMMIT");
    return res;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Creates a context-aware `Pool` facade:
 * - Inside `withAccountContext` / `withServiceRole`: routes `.query(...)`
 *   through the checked-out transaction client.
 * - Inside `runWithRequestAccount` (`jwtAuth` middleware): automatically wraps
 *   each standalone `.query(...)` in `withAccountContext(ctx.account, ...)`.
 * - Outside any scope: executes with `app.account = ''` and `app.role = ''` so
 *   RLS policies deny unscoped access to user tables.
 */
export function createRlsAwarePool(backingPool: TransactionalPool): Pool {
  return new Proxy(backingPool as Pool, {
    get(target, prop, receiver) {
      if (prop === "query") {
        return <R extends QueryResultRow = any>(
          queryText: string,
          values?: any[]
        ): Promise<QueryResult<R>> => {
          const active = rlsStorage.getStore();
          if (active?.client && active.poolRef === backingPool) {
            return active.client.query<R>(queryText, values);
          }
          if (active?.mode === "account" && active.account) {
            return withAccountContext(
              active.account,
              (tx) => tx.query<R>(queryText, values),
              backingPool
            );
          }
          if (active?.mode === "service") {
            return withServiceRole(
              (tx) => tx.query<R>(queryText, values),
              { jobName: active.jobName, db: backingPool }
            );
          }
          return executeUnscopedQuery<R>(backingPool, queryText, values);
        };
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === "function" ? val.bind(target) : val;
    },
  });
}

export const pool: Pool = createRlsAwarePool(rawPool);

/**
 * Enables and forces PostgreSQL Row-Level Security on every user-scoped table,
 * provisions least-privilege `NOBYPASSRLS` roles when permitted by the server,
 * and installs idempotent account-isolation and service-role policies.
 */
export async function ensureRlsPolicies(db: Queryable = rawPool): Promise<void> {
  // Provision non-superuser, NOBYPASSRLS roles when the connected DB user has
  // privilege to do so (e.g. local Docker Postgres or migration role). On
  // managed Postgres without CREATEROLE, `insufficient_privilege` is caught
  // cleanly and FORCE ROW LEVEL SECURITY still protects non-superuser roles.
  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RLS_APP_ROLE}') THEN
        CREATE ROLE ${RLS_APP_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RLS_SERVICE_ROLE}') THEN
        CREATE ROLE ${RLS_SERVICE_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
    EXCEPTION
      WHEN duplicate_object OR insufficient_privilege THEN
        NULL;
    END
    $$;
  `);

  await db.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RLS_APP_ROLE}') THEN
        GRANT USAGE ON SCHEMA public TO ${RLS_APP_ROLE};
        GRANT SELECT, INSERT, UPDATE, DELETE ON
          keypair_audit_log,
          idempotency_keys,
          devices,
          verified_emails,
          pending_txs,
          sessions,
          user_preferences
        TO ${RLS_APP_ROLE};
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${RLS_APP_ROLE};
      END IF;

      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RLS_SERVICE_ROLE}') THEN
        GRANT USAGE ON SCHEMA public TO ${RLS_SERVICE_ROLE};
        GRANT SELECT, INSERT, UPDATE, DELETE ON
          keypair_audit_log,
          idempotency_keys,
          devices,
          verified_emails,
          pending_txs,
          sessions,
          user_preferences
        TO ${RLS_SERVICE_ROLE};
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${RLS_SERVICE_ROLE};
      END IF;
    EXCEPTION
      WHEN insufficient_privilege OR undefined_object THEN
        NULL;
    END
    $$;
  `);

  for (const { table, ownerColumn } of USER_SCOPED_RLS_TABLES) {
    const isolationPolicy = `${table}_account_isolation`;
    const servicePolicy = `${table}_service_bypass`;

    await db.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await db.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);

    await db.query(`DROP POLICY IF EXISTS ${isolationPolicy} ON ${table}`);
    await db.query(`
      CREATE POLICY ${isolationPolicy} ON ${table}
        AS PERMISSIVE
        FOR ALL
        USING (
          ${ownerColumn} = NULLIF(current_setting('app.account', true), '')
          AND COALESCE(current_setting('app.role', true), 'authenticated') <> 'service'
        )
        WITH CHECK (
          ${ownerColumn} = NULLIF(current_setting('app.account', true), '')
          AND COALESCE(current_setting('app.role', true), 'authenticated') <> 'service'
        )
    `);

    await db.query(`DROP POLICY IF EXISTS ${servicePolicy} ON ${table}`);
    await db.query(`
      CREATE POLICY ${servicePolicy} ON ${table}
        AS PERMISSIVE
        FOR ALL
        USING (current_setting('app.role', true) = 'service')
        WITH CHECK (current_setting('app.role', true) = 'service')
    `);
  }

  invalidateRoleCache(db);
}

export async function ensureAuditTable(db: Queryable = rawPool) {
  // #219 — run managed migrations before legacy idempotent checks
  if (db === rawPool) {
    try {
      await runMigrations(rawPool, "up");
    } catch (err) {
      console.error("[migrations] Error executing migrations:", err);
    }
  }
  await db.query(`
    CREATE TABLE IF NOT EXISTS keypair_audit_log (
      id BIGSERIAL PRIMARY KEY,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      api_key_hash VARCHAR(64) NOT NULL,
      public_key VARCHAR(56) NOT NULL
    )
  `);

  await db.query(`
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
  await db.query(`
    ALTER TABLE idempotency_keys
      ADD COLUMN IF NOT EXISTS request_fingerprint VARCHAR(64) NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS committed BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS network VARCHAR(16) NOT NULL DEFAULT '${config.STELLAR_NETWORK}'
  `);

  // #87 — device token table for push notifications.
  await ensureDevicesTable(db);

  // #90 — verified email table for email notification fallback.
  await ensureVerifiedEmailsTable(db);

  // #74 — pending multisig transaction store for co-signers.
  await ensurePendingTxsTable(db);

  // #37 — first-class session records for listing and revoke-all.
  await ensureSessionsTable(db);

  // #68 — user preferences.
  await ensurePreferencesTable(db);

  // #194 — hashes of transactions the build endpoints returned.
  await ensureBuiltTransactionsTable(db as Pool);

  // #195 — per-user fee-sponsorship budget tracking.
  await ensureFeeSponsorshipTable(db as Pool);

  // #79 — activity feed events and cursor table.
  await ensureActivityFeedTable();

  // #282 — Postgres row-level security policies across all user-scoped tables.
  await ensureRlsPolicies(db);
}

export async function ensurePendingTxsTable(db: Queryable) {
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

export async function ensureSessionsTable(db: Queryable) {
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
