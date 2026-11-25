import { Pool, PoolClient } from "pg";

export interface Migration {
  name: string;
  up: (client: PoolClient) => Promise<void>;
  down: (client: PoolClient) => Promise<void>;
}

export const migrations: Migration[] = [
  {
    name: "001_initial_schema",
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS keypair_audit_log (
          id BIGSERIAL PRIMARY KEY,
          issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          api_key_hash VARCHAR(64) NOT NULL,
          public_key VARCHAR(56) NOT NULL
        );

        CREATE TABLE IF NOT EXISTS idempotency_keys (
          id BIGSERIAL PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          source_public_key VARCHAR(56) NOT NULL,
          idempotency_key VARCHAR(255) NOT NULL,
          request_fingerprint VARCHAR(64) NOT NULL DEFAULT '',
          result_hash VARCHAR(64) NOT NULL DEFAULT '',
          result_successful BOOLEAN NOT NULL DEFAULT false,
          committed BOOLEAN NOT NULL DEFAULT false,
          UNIQUE (source_public_key, idempotency_key)
        );

        CREATE TABLE IF NOT EXISTS pending_txs (
          id BIGSERIAL PRIMARY KEY,
          account VARCHAR(56) NOT NULL,
          xdr TEXT NOT NULL,
          required_weight INTEGER NOT NULL,
          collected_signers JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_by VARCHAR(56) NOT NULL,
          expires_at TIMESTAMPTZ,
          status VARCHAR(16) NOT NULL DEFAULT 'pending',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    },
    down: async (client) => {
      await client.query(`
        DROP TABLE IF EXISTS pending_txs CASCADE;
        DROP TABLE IF EXISTS idempotency_keys CASCADE;
        DROP TABLE IF EXISTS keypair_audit_log CASCADE;
      `);
    },
  },
  {
    name: "002_hot_indexes",
    up: async (client) => {
      await client.query(`
        -- Hot query index for multisig pending transaction status checks
        CREATE INDEX IF NOT EXISTS pending_txs_account_status_idx
          ON pending_txs (account, status, created_at DESC);

        -- Expiry sweep index for open pending transactions
        CREATE INDEX IF NOT EXISTS pending_txs_expires_at_idx
          ON pending_txs (expires_at)
          WHERE status = 'pending';

        -- Cleanup index for aged idempotency keys
        CREATE INDEX IF NOT EXISTS idempotency_keys_created_at_idx
          ON idempotency_keys (created_at);
      `);
    },
    down: async (client) => {
      await client.query(`
        DROP INDEX IF EXISTS pending_txs_account_status_idx;
        DROP INDEX IF EXISTS pending_txs_expires_at_idx;
        DROP INDEX IF EXISTS idempotency_keys_created_at_idx;
      `);
    },
  },
  {
    name: "003_session_store_schema",
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id VARCHAR(64) PRIMARY KEY,
          sub VARCHAR(56) NOT NULL,
          device_id VARCHAR(64),
          device_label VARCHAR(128),
          user_agent TEXT,
          ip_hash VARCHAR(64),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          revoked BOOLEAN NOT NULL DEFAULT false,
          revoked_at TIMESTAMPTZ
        );

        CREATE INDEX IF NOT EXISTS sessions_sub_last_used_idx
          ON sessions (sub, last_used_at DESC);
      `);
    },
    down: async (client) => {
      await client.query(`
        DROP TABLE IF EXISTS sessions CASCADE;
      `);
    },
  },
  {
    name: "004_fx_rate_snapshots",
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS fx_rate_snapshots (
          id BIGSERIAL PRIMARY KEY,
          date DATE NOT NULL,
          base_currency VARCHAR(3) NOT NULL,
          quote_currency VARCHAR(3) NOT NULL,
          rate DECIMAL(20, 10) NOT NULL,
          source VARCHAR(255) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (date, base_currency, quote_currency)
        );

        CREATE INDEX IF NOT EXISTS fx_rate_snapshots_date_currency_idx
          ON fx_rate_snapshots (date, base_currency, quote_currency);

        CREATE INDEX IF NOT EXISTS fx_rate_snapshots_date_idx
          ON fx_rate_snapshots (date);
      `);
    },
    down: async (client) => {
      await client.query(`
        DROP INDEX IF EXISTS fx_rate_snapshots_date_idx;
        DROP INDEX IF EXISTS fx_rate_snapshots_date_currency_idx;
        DROP TABLE IF EXISTS fx_rate_snapshots CASCADE;
      `);
    },
  },
  {
    // 003 created `sessions` keyed by `sub`, but everything that reads the
    // table (RLS policy, retention purge, ensureSessionsTable's indexes)
    // uses `account`/`refresh_hash`, so booting on a freshly migrated DB
    // failed with 'column "account" does not exist'. Bring 003's table to
    // the shape the code expects without dropping data.
    name: "005_sessions_account_columns",
    up: async (client) => {
      await client.query(`
        ALTER TABLE sessions
          ADD COLUMN IF NOT EXISTS account VARCHAR(56),
          ADD COLUMN IF NOT EXISTS refresh_hash VARCHAR(64);

        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_name = 'sessions' AND column_name = 'sub'
          ) THEN
            UPDATE sessions SET account = sub WHERE account IS NULL;
            ALTER TABLE sessions ALTER COLUMN sub DROP NOT NULL;
          END IF;
        END $$;

        UPDATE sessions SET refresh_hash = '' WHERE refresh_hash IS NULL;
        ALTER TABLE sessions ALTER COLUMN account SET NOT NULL;
        ALTER TABLE sessions ALTER COLUMN refresh_hash SET DEFAULT '';
        ALTER TABLE sessions ALTER COLUMN refresh_hash SET NOT NULL;

        CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions (account);
        CREATE INDEX IF NOT EXISTS sessions_refresh_hash_idx ON sessions (refresh_hash);
      `);
    },
    down: async (client) => {
      await client.query(`
        DROP INDEX IF EXISTS sessions_refresh_hash_idx;
        DROP INDEX IF EXISTS sessions_account_idx;
        ALTER TABLE sessions DROP COLUMN IF EXISTS refresh_hash;
        ALTER TABLE sessions DROP COLUMN IF EXISTS account;
      `);
    },
  },
];

/** Arbitrary constant key for the migration advisory lock. */
const MIGRATION_LOCK_KEY = 72_841_903;

/**
 * Migration names must be "NNN_description", unique and strictly
 * increasing, so the apply order is unambiguous across branches.
 */
export function assertMigrationOrder(list: Migration[] = migrations): void {
  let previous = 0;
  const seen = new Set<string>();
  for (const m of list) {
    const match = /^(\d{3,})_[a-z0-9_]+$/.exec(m.name);
    if (!match) throw new Error(`Migration name "${m.name}" must look like 001_description`);
    const version = Number(match[1]);
    if (seen.has(match[1]) || version <= previous) {
      throw new Error(`Migration "${m.name}" has a duplicate or out-of-order version`);
    }
    seen.add(match[1]);
    previous = version;
  }
}

export async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function getAppliedMigrations(client: PoolClient): Promise<string[]> {
  await ensureMigrationTable(client);
  const { rows } = await client.query<{ name: string }>(
    `SELECT name FROM schema_migrations ORDER BY id ASC`
  );
  return rows.map((r) => r.name);
}

export async function runMigrations(pool: Pool, direction: "up" | "down" = "up"): Promise<string[]> {
  assertMigrationOrder();
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    // Several instances boot at once in production; serialise them so two
    // never apply the same migration concurrently.
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await ensureMigrationTable(client);
    const existing = await getAppliedMigrations(client);

    if (direction === "up") {
      for (const m of migrations) {
        if (!existing.includes(m.name)) {
          console.log(`[migrations] Applying migration: ${m.name}`);
          await client.query("BEGIN");
          try {
            await m.up(client);
            await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [m.name]);
            await client.query("COMMIT");
            applied.push(m.name);
          } catch (err) {
            await client.query("ROLLBACK");
            throw new Error(`Migration ${m.name} failed: ${(err as Error).message}`);
          }
        }
      }
    } else {
      const rollbackTarget = migrations.filter((m) => existing.includes(m.name)).reverse();
      for (const m of rollbackTarget) {
        console.log(`[migrations] Rolling back migration: ${m.name}`);
        await client.query("BEGIN");
        try {
          await m.down(client);
          await client.query(`DELETE FROM schema_migrations WHERE name = $1`, [m.name]);
          await client.query("COMMIT");
          applied.push(m.name);
        } catch (err) {
          await client.query("ROLLBACK");
          throw new Error(`Rollback of ${m.name} failed: ${(err as Error).message}`);
        }
      }
    }

    return applied;
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY])
      .catch(() => undefined);
    client.release();
  }
}
