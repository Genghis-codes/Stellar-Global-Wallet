import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  createRlsAwarePool,
  ensureAuditTable,
  Queryable,
  rawPool,
  RLS_APP_ROLE,
  RLS_SERVICE_ROLE,
  runWithRequestAccount,
  TransactionalPool,
  USER_SCOPED_RLS_TABLES,
  withAccountContext,
  withServiceRole,
} from "../../src/db";
import {
  deleteDevice,
  getDevicesForAccounts,
  listDevices,
  upsertDevice,
} from "../../src/services/deviceRegistry";
import { createPreferencesRouter, PgPreferencesStore } from "../../src/routes/preferences";
import { PgPendingTxStore } from "../../src/services/pendingTxs";
import { cacheResult, getCachedResult } from "../../src/services/idempotency";
import { generateAccessToken } from "../../src/utils/jwt";
import { errorHandler } from "../../src/middleware/errorHandler";

// ---------------------------------------------------------------------------
//  Deterministic multi-connection RLS simulator (runs without external DB)
// ---------------------------------------------------------------------------

type RowRecord = Record<string, any>;

const OWNER_COLUMN_BY_TABLE: Record<string, string> = Object.fromEntries(
  USER_SCOPED_RLS_TABLES.map((entry) => [entry.table, entry.ownerColumn])
);

class SimulatedRlsPool implements TransactionalPool {
  readonly tables = new Map<string, RowRecord[]>();
  private nextId = 1;
  readonly connectionStates: Array<{
    inTx: boolean;
    account: string;
    role: string;
    dbRole: string;
    released: boolean;
  }> = [];

  constructor() {
    for (const { table } of USER_SCOPED_RLS_TABLES) {
      this.tables.set(table, []);
    }
  }

  private matchesRls(table: string, row: RowRecord, account: string, role: string): boolean {
    if (role === "service") return true;
    const ownerCol = OWNER_COLUMN_BY_TABLE[table];
    if (!ownerCol) return true;
    if (!account) return false;
    return row[ownerCol] === account && role !== "service";
  }

  private createClientState() {
    const state = {
      inTx: false,
      account: "",
      role: "",
      dbRole: "superuser",
      released: false,
      snapshot: null as Map<string, RowRecord[]> | null,
    };
    this.connectionStates.push(state);
    return state;
  }

  private cloneTables(): Map<string, RowRecord[]> {
    const copy = new Map<string, RowRecord[]>();
    for (const [k, rows] of this.tables.entries()) {
      copy.set(
        k,
        rows.map((r) => ({ ...r }))
      );
    }
    return copy;
  }

  async connect(): Promise<any> {
    const state = this.createClientState();
    const executeQuery = async (sql: string, values: any[] = []): Promise<any> => {
      const normalized = sql.trim().replace(/\s+/g, " ");

      if (/^BEGIN$/i.test(normalized)) {
        state.inTx = true;
        state.snapshot = this.cloneTables();
        return { rows: [], rowCount: 0 };
      }
      if (/^COMMIT$/i.test(normalized)) {
        state.inTx = false;
        state.account = "";
        state.role = "";
        state.dbRole = "superuser";
        state.snapshot = null;
        return { rows: [], rowCount: 0 };
      }
      if (/^ROLLBACK$/i.test(normalized)) {
        if (state.snapshot) {
          this.tables.clear();
          for (const [k, rows] of state.snapshot.entries()) {
            this.tables.set(k, rows);
          }
        }
        state.inTx = false;
        state.account = "";
        state.role = "";
        state.dbRole = "superuser";
        state.snapshot = null;
        return { rows: [], rowCount: 0 };
      }
      if (/pg_roles/i.test(normalized)) {
        return { rows: [{ exists: true }], rowCount: 1 };
      }
      if (/^SET LOCAL ROLE /i.test(normalized)) {
        state.dbRole = normalized.split(" ").pop() ?? "";
        return { rows: [], rowCount: 0 };
      }
      if (/set_config\('app\.role'/i.test(normalized)) {
        if (normalized.includes("'authenticated'")) {
          state.role = "authenticated";
          state.account = String(values[0] ?? "");
        } else if (normalized.includes("'service'")) {
          state.role = "service";
          state.account = "";
        } else {
          state.role = "";
          state.account = "";
        }
        return { rows: [], rowCount: 1 };
      }

      // INSERT INTO devices
      if (/^INSERT INTO devices/i.test(normalized)) {
        const [account, platform, token, locale] = values;
        const candidate = {
          id: String(this.nextId++),
          account,
          platform,
          token,
          locale,
          created_at: new Date(),
          last_seen_at: new Date(),
        };
        if (!this.matchesRls("devices", candidate, state.account, state.role)) {
          throw Object.assign(
            new Error('new row violates row-level security policy for table "devices"'),
            { code: "42501" }
          );
        }
        const rows = this.tables.get("devices")!;
        const existing = rows.find((r) => r.account === account && r.token === token);
        if (existing) {
          existing.locale = locale;
          existing.last_seen_at = new Date();
          return { rows: [{ ...existing }], rowCount: 1 };
        }
        rows.push(candidate);
        return { rows: [{ ...candidate }], rowCount: 1 };
      }

      // SELECT FROM devices
      if (/FROM devices/i.test(normalized) && /^SELECT/i.test(normalized)) {
        const visible = this.tables
          .get("devices")!
          .filter((r) => this.matchesRls("devices", r, state.account, state.role));
        if (/SELECT DISTINCT account/i.test(normalized)) {
          const distinct = [...new Set(visible.map((r) => r.account))].map((account) => ({
            account,
          }));
          return { rows: distinct, rowCount: distinct.length };
        }
        if (/WHERE account IN/i.test(normalized)) {
          const matched = visible.filter((r) => values.includes(r.account));
          return { rows: matched, rowCount: matched.length };
        }
        if (/WHERE account = \$1/i.test(normalized)) {
          const matched = visible.filter((r) => r.account === values[0]);
          return { rows: matched, rowCount: matched.length };
        }
        // Raw SELECT * FROM devices without WHERE
        return { rows: visible, rowCount: visible.length };
      }

      // DELETE FROM devices
      if (/^DELETE FROM devices/i.test(normalized)) {
        const rows = this.tables.get("devices")!;
        const kept: RowRecord[] = [];
        let deleted = 0;
        for (const r of rows) {
          const visible = this.matchesRls("devices", r, state.account, state.role);
          const matchesWhere = /AND account = \$2/i.test(normalized)
            ? r.id === String(values[0]) && r.account === values[1]
            : r.id === String(values[0]);
          if (visible && matchesWhere) {
            deleted++;
          } else {
            kept.push(r);
          }
        }
        this.tables.set("devices", kept);
        return { rows: [], rowCount: deleted };
      }

      // INSERT / SELECT user_preferences
      if (/^INSERT INTO user_preferences/i.test(normalized)) {
        const [account, jsonPatch] = values;
        const patch = JSON.parse(jsonPatch);
        const candidate = { account, preferences: patch, updated_at: new Date() };
        if (!this.matchesRls("user_preferences", candidate, state.account, state.role)) {
          throw Object.assign(
            new Error('new row violates row-level security policy for table "user_preferences"'),
            { code: "42501" }
          );
        }
        const rows = this.tables.get("user_preferences")!;
        const existing = rows.find((r) => r.account === account);
        if (existing) {
          existing.preferences = { ...existing.preferences, ...patch };
          return { rows: [{ preferences: existing.preferences }], rowCount: 1 };
        }
        rows.push(candidate);
        return { rows: [{ preferences: candidate.preferences }], rowCount: 1 };
      }

      if (/FROM user_preferences/i.test(normalized) && /^SELECT/i.test(normalized)) {
        const visible = this.tables
          .get("user_preferences")!
          .filter((r) => this.matchesRls("user_preferences", r, state.account, state.role));
        const filtered = /WHERE account = \$1/i.test(normalized)
          ? visible.filter((r) => r.account === values[0])
          : visible;
        return { rows: filtered, rowCount: filtered.length };
      }

      // Generic SELECT * FROM <table> / INSERT INTO <table> for remaining user tables
      for (const { table, ownerColumn } of USER_SCOPED_RLS_TABLES) {
        if (new RegExp(`^SELECT \\* FROM ${table}$`, "i").test(normalized)) {
          const visible = this.tables
            .get(table)!
            .filter((r) => this.matchesRls(table, r, state.account, state.role));
          return { rows: visible, rowCount: visible.length };
        }
        if (new RegExp(`^INSERT INTO ${table}`, "i").test(normalized)) {
          const ownerValue = values[0];
          const candidate: RowRecord = {
            id: String(this.nextId++),
            [ownerColumn]: ownerValue,
            created_at: new Date(),
          };
          if (table === "idempotency_keys") {
            candidate.idempotency_key = values[1];
            candidate.result_hash = values[2];
            candidate.result_successful = values[3];
          }
          if (!this.matchesRls(table, candidate, state.account, state.role)) {
            throw Object.assign(
              new Error(`new row violates row-level security policy for table "${table}"`),
              { code: "42501" }
            );
          }
          this.tables.get(table)!.push(candidate);
          return { rows: [candidate], rowCount: 1 };
        }
        if (
          table === "idempotency_keys" &&
          /FROM idempotency_keys/i.test(normalized) &&
          /^SELECT/i.test(normalized)
        ) {
          const visible = this.tables
            .get("idempotency_keys")!
            .filter((r) => this.matchesRls("idempotency_keys", r, state.account, state.role));
          const matched = visible.filter(
            (r) => r.source_public_key === values[0] && r.idempotency_key === values[1]
          );
          return { rows: matched, rowCount: matched.length };
        }
      }

      return { rows: [], rowCount: 0 };
    };

    return {
      query: executeQuery,
      release: () => {
        state.released = true;
      },
    };
  }

  async query<R extends Record<string, any> = any>(sql: string, values?: any[]): Promise<any> {
    const client = await this.connect();
    try {
      return await client.query(sql, values);
    } finally {
      client.release();
    }
  }
}

describe("Postgres Row-Level Security for user-scoped tables (#282)", () => {
  const alice = StellarSdk.Keypair.random().publicKey();
  const bob = StellarSdk.Keypair.random().publicKey();
  const cosigner = StellarSdk.Keypair.random().publicKey();

  describe("DDL & policy bootstrap (ensureAuditTable / ensureRlsPolicies)", () => {
    it("enables and forces RLS and installs isolation + service policies on all 6 user-scoped tables", async () => {
      const queries: string[] = [];
      const mockDb: Queryable = {
        query: jest.fn(async (sql: string) => {
          queries.push(sql.replace(/\s+/g, " ").trim());
          return { rows: [], rowCount: 0 } as any;
        }),
      };

      await ensureAuditTable(mockDb);

      const joined = queries.join("\n");
      expect(joined).toContain(`CREATE ROLE ${RLS_APP_ROLE} NOLOGIN NOSUPERUSER`);
      expect(joined).toContain(`CREATE ROLE ${RLS_SERVICE_ROLE} NOLOGIN NOSUPERUSER`);
      expect(joined).toContain("NOBYPASSRLS");

      for (const { table, ownerColumn } of USER_SCOPED_RLS_TABLES) {
        expect(queries).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
        expect(queries).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
        expect(joined).toContain(`CREATE POLICY ${table}_account_isolation ON ${table}`);
        expect(joined).toContain(`${ownerColumn} = NULLIF(current_setting('app.account', true), '')`);
        expect(joined).toContain(`CREATE POLICY ${table}_service_bypass ON ${table}`);
      }
    });
  });

  describe("Transactional scoping, IDOR defence-in-depth, and service-role bypass", () => {
    let simPool: SimulatedRlsPool;
    let rlsPool: ReturnType<typeof createRlsAwarePool>;

    beforeEach(() => {
      simPool = new SimulatedRlsPool();
      rlsPool = createRlsAwarePool(simPool);
    });

    it("returns zero rows for unscoped queries across every user-scoped table and blocks unscoped inserts", async () => {
      // Seed rows for Alice under her legitimate account context
      await withAccountContext(
        alice,
        async (tx) => {
          await upsertDevice(alice, "expo", "ExponentPushToken[alice-1]", "en", tx);
          await cacheResult(alice, "idem-1", "a".repeat(64), true, tx);
          for (const { table } of USER_SCOPED_RLS_TABLES) {
            if (table === "devices" || table === "idempotency_keys" || table === "user_preferences") {
              continue;
            }
            await tx.query(`INSERT INTO ${table} VALUES ($1)`, [alice]);
          }
          await new PgPreferencesStore(tx).merge(alice, { currency: "USD" });
        },
        simPool
      );

      // Unscoped SELECT on every user-scoped table MUST return zero rows
      for (const { table } of USER_SCOPED_RLS_TABLES) {
        const unscoped = await rlsPool.query(`SELECT * FROM ${table}`);
        expect(unscoped.rows).toEqual([]);
      }

      // Unscoped helper calls via rlsPool also return empty / fail closed
      expect(await listDevices(alice, rlsPool)).toEqual([]);
      await expect(
        upsertDevice(alice, "expo", "ExponentPushToken[unscoped]", "en", rlsPool)
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("prevents cross-account reads, updates, and deletes even if application SQL omits WHERE account = $1", async () => {
      const aliceDevice = await withAccountContext(
        alice,
        (tx) => upsertDevice(alice, "expo", "ExponentPushToken[alice]", "en", tx),
        simPool
      );
      await withAccountContext(
        bob,
        (tx) => upsertDevice(bob, "expo", "ExponentPushToken[bob]", "tr", tx),
        simPool
      );

      // Raw query without WHERE account = $1 inside Bob's context ONLY sees Bob's row
      const bobRawView = await withAccountContext(
        bob,
        (tx) => tx.query("SELECT * FROM devices"),
        simPool
      );
      expect(bobRawView.rows).toHaveLength(1);
      expect(bobRawView.rows[0].account).toBe(bob);

      // Raw DELETE by primary key alone (simulating a missing `AND account = $2` IDOR bug) cannot delete Alice's row
      const bobDeleteAttempt = await withAccountContext(
        bob,
        (tx) => tx.query("DELETE FROM devices WHERE id = $1", [aliceDevice.id]),
        simPool
      );
      expect(bobDeleteAttempt.rowCount).toBe(0);

      // Alice's row is still intact
      const aliceDevices = await withAccountContext(
        alice,
        (tx) => listDevices(alice, tx),
        simPool
      );
      expect(aliceDevices).toHaveLength(1);
      expect(aliceDevices[0].id).toBe(aliceDevice.id);

      // WITH CHECK blocks Bob from inserting a row attributed to Alice
      await expect(
        withAccountContext(
          bob,
          (tx) => upsertDevice(alice, "expo", "ExponentPushToken[spoof]", "en", tx),
          simPool
        )
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("rolls back on error, releases pooled connections, and isolates concurrent account transactions", async () => {
      await expect(
        withAccountContext(
          alice,
          async (tx) => {
            await upsertDevice(alice, "expo", "ExponentPushToken[rolled-back]", "en", tx);
            throw new Error("simulated failure mid-transaction");
          },
          simPool
        )
      ).rejects.toThrow("simulated failure mid-transaction");

      // Rolled-back insert must not persist, and pooled client must be released with cleared GUC state
      const afterRollback = await withAccountContext(
        alice,
        (tx) => listDevices(alice, tx),
        simPool
      );
      expect(afterRollback).toEqual([]);
      expect(simPool.connectionStates.every((c) => c.released && c.account === "")).toBe(true);

      // Concurrent requests for Alice and Bob never leak app.account across async boundaries
      const [alicePrefs, bobPrefs] = await Promise.all([
        withAccountContext(
          alice,
          async (tx) => {
            const store = new PgPreferencesStore(tx);
            await store.merge(alice, { currency: "EUR" });
            await new Promise((r) => setTimeout(r, 15));
            return store.get(alice);
          },
          simPool
        ),
        withAccountContext(
          bob,
          async (tx) => {
            const store = new PgPreferencesStore(tx);
            await store.merge(bob, { currency: "JPY" });
            await new Promise((r) => setTimeout(r, 5));
            return store.get(bob);
          },
          simPool
        ),
      ]);

      expect(alicePrefs).toEqual({ currency: "EUR" });
      expect(bobPrefs).toEqual({ currency: "JPY" });
    });

    it("grants cross-account visibility to background jobs via withServiceRole and resets afterward", async () => {
      await withAccountContext(
        alice,
        (tx) => upsertDevice(alice, "expo", "ExponentPushToken[alice]", "en", tx),
        simPool
      );
      await withAccountContext(
        bob,
        (tx) => upsertDevice(bob, "expo", "ExponentPushToken[bob]", "en", tx),
        simPool
      );

      // Background job (paymentNotifier / recoveryNotifier pattern) sees both accounts
      const allAccounts = await withServiceRole(
        (tx) => tx.query<{ account: string }>("SELECT DISTINCT account FROM devices"),
        { jobName: "test.paymentNotifier", db: simPool }
      );
      expect(allAccounts.rows.map((r) => r.account).sort()).toEqual([alice, bob].sort());

      const notifyDevices = await withServiceRole(
        (tx) => getDevicesForAccounts([alice, bob], tx),
        { jobName: "test.recoveryNotifier", db: simPool }
      );
      expect(notifyDevices).toHaveLength(2);

      // Immediately after withServiceRole finishes, unscoped queries return zero rows again
      const unscopedAfter = await rlsPool.query("SELECT * FROM devices");
      expect(unscopedAfter.rows).toEqual([]);
    });

    it("binds JWT sub to request transactions on Express routes via jwtAuth + runWithRequestAccount", async () => {
      const app = express();
      app.use(express.json());
      app.use("/api/v1/me/preferences", createPreferencesRouter(new PgPreferencesStore(simPool)));
      app.use(errorHandler);

      const aliceToken = generateAccessToken(alice, "sep10");
      const bobToken = generateAccessToken(bob, "sep10");

      await request(app)
        .put("/api/v1/me/preferences")
        .set("Authorization", `Bearer ${aliceToken}`)
        .send({ currency: "GBP", language: "en" })
        .expect(200);

      await request(app)
        .put("/api/v1/me/preferences")
        .set("Authorization", `Bearer ${bobToken}`)
        .send({ currency: "TRY", language: "tr" })
        .expect(200);

      const aliceGet = await request(app)
        .get("/api/v1/me/preferences")
        .set("Authorization", `Bearer ${aliceToken}`)
        .expect(200);
      expect(aliceGet.body.preferences).toEqual({ currency: "GBP", language: "en" });

      // Ambient runWithRequestAccount also scopes standalone rlsPool.query calls
      const scopedResult = await runWithRequestAccount(alice, () =>
        rlsPool.query("SELECT preferences FROM user_preferences")
      );
      expect(scopedResult.rows).toMatchObject([
        { account: alice, preferences: { currency: "GBP", language: "en" } },
      ]);
    });
  });

  describe("Live PostgreSQL engine verification (runs when DATABASE_URL is reachable)", () => {
    let pgAvailable = false;

    beforeAll(async () => {
      try {
        await rawPool.query("SELECT 1");
        await ensureAuditTable(rawPool);
        pgAvailable = true;
      } catch {
        pgAvailable = false;
      }
    }, 20_000);

    afterAll(async () => {
      if (pgAvailable) {
        await rawPool.end().catch(() => undefined);
      }
    });

    it(
      "enforces FORCE ROW LEVEL SECURITY, zero-row unscoped queries, cross-account isolation, and service bypass in real PostgreSQL",
      async () => {
      if (process.env.TEST_REQUIRE_POSTGRES === "1") {
        expect(pgAvailable).toBe(true);
      }
      if (!pgAvailable) {
        return;
      }

      const pgPool = createRlsAwarePool(rawPool);

      // 1. Verify pg_class relrowsecurity & relforcerowsecurity + pg_policies on all 6 tables
      const catalog = await rawPool.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class
         WHERE relname = ANY($1::text[])`,
        [USER_SCOPED_RLS_TABLES.map((t) => t.table)]
      );
      expect(catalog.rows).toHaveLength(USER_SCOPED_RLS_TABLES.length);
      for (const row of catalog.rows) {
        expect(row.relrowsecurity).toBe(true);
        expect(row.relforcerowsecurity).toBe(true);
      }

      const policies = await rawPool.query<{ tablename: string; policyname: string }>(
        `SELECT tablename, policyname
         FROM pg_policies
         WHERE tablename = ANY($1::text[])`,
        [USER_SCOPED_RLS_TABLES.map((t) => t.table)]
      );
      expect(policies.rows).toHaveLength(USER_SCOPED_RLS_TABLES.length * 2);

      // 2. Seed rows for Alice and Bob across all 6 user-scoped tables
      const aliceSessionId = crypto.randomUUID();
      const bobSessionId = crypto.randomUUID();

      let aliceDeviceId = "";
      let alicePendingId = "";

      await withAccountContext(alice, async (tx) => {
        const dev = await upsertDevice(alice, "expo", `ExponentPushToken[${alice.slice(0, 8)}]`, "en", tx);
        aliceDeviceId = dev.id;
        await tx.query(
          `INSERT INTO verified_emails (account, email, verified) VALUES ($1, $2, TRUE)
           ON CONFLICT (account) DO UPDATE SET email = EXCLUDED.email`,
          [alice, "alice@example.com"]
        );
        await new PgPreferencesStore(tx).merge(alice, { currency: "USD" });
        await tx.query(
          `INSERT INTO sessions (id, account, refresh_hash) VALUES ($1, $2, $3)`,
          [aliceSessionId, alice, "h_alice"]
        );
        await cacheResult(alice, "live-idem-1", "1".repeat(64), true, tx);
        const ptx = await new PgPendingTxStore(tx).create({
          account: alice,
          xdr: "AAAA_ALICE_XDR",
          requiredWeight: 2,
          collectedSigners: [alice],
          createdBy: alice,
          expiresAt: null,
          status: "pending",
        });
        alicePendingId = ptx.id;
      });

      await withAccountContext(bob, async (tx) => {
        await upsertDevice(bob, "expo", `ExponentPushToken[${bob.slice(0, 8)}]`, "tr", tx);
        await tx.query(
          `INSERT INTO verified_emails (account, email, verified) VALUES ($1, $2, TRUE)
           ON CONFLICT (account) DO UPDATE SET email = EXCLUDED.email`,
          [bob, "bob@example.com"]
        );
        await new PgPreferencesStore(tx).merge(bob, { currency: "EUR" });
        await tx.query(
          `INSERT INTO sessions (id, account, refresh_hash) VALUES ($1, $2, $3)`,
          [bobSessionId, bob, "h_bob"]
        );
        await cacheResult(bob, "live-idem-1", "2".repeat(64), true, tx);
      });

      // 3. Unscoped queries against pgPool MUST return 0 rows on every user-scoped table
      for (const { table } of USER_SCOPED_RLS_TABLES) {
        const unscoped = await pgPool.query(`SELECT * FROM ${table}`);
        expect(unscoped.rows).toEqual([]);
      }

      // Unscoped INSERT fails with Postgres RLS violation 42501
      await expect(
        pgPool.query(
          `INSERT INTO devices (account, platform, token, locale) VALUES ($1, 'expo', 'ExponentPushToken[bad]', 'en')`,
          [alice]
        )
      ).rejects.toMatchObject({ code: "42501" });

      // 4. Cross-account isolation: Bob running `SELECT * FROM <table>` (WITHOUT WHERE!) never sees Alice's rows
      await withAccountContext(bob, async (tx) => {
        for (const { table, ownerColumn } of USER_SCOPED_RLS_TABLES) {
          const { rows } = await tx.query(`SELECT * FROM ${table}`);
          expect(rows.every((r) => r[ownerColumn] === bob)).toBe(true);
          expect(rows.some((r) => r[ownerColumn] === alice)).toBe(false);
        }

        // Bob attempting to delete Alice's device by primary key without account filter deletes 0 rows
        const del = await tx.query(`DELETE FROM devices WHERE id = $1`, [aliceDeviceId]);
        expect(del.rowCount).toBe(0);

        // Bob attempting to read Alice's cached idempotency result sees null
        expect(await getCachedResult(alice, "live-idem-1", tx)).toBeNull();
      });

      // 5. Service role bypasses RLS for background jobs and multisig signer lookups
      const workerDevices = await withServiceRole((tx) =>
        getDevicesForAccounts([alice, bob], tx)
      );
      expect(workerDevices.map((d) => d.account).sort()).toEqual([alice, bob].sort());

      const pendingLookup = await new PgPendingTxStore(rawPool).getForSignerCheck(alicePendingId);
      expect(pendingLookup?.account).toBe(alice);
      expect(cosigner).toBeDefined();
    },
    20_000
    );
  });
});
