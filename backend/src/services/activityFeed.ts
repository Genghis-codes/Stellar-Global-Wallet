import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "../config";
import { StellarService } from "./stellar";
import { pool } from "../db";
import { metrics } from "./metrics";

export interface UnifiedActivityItem {
  id: string;
  source: "payment" | "contract_event";
  timestamp: string; // ISO 8601
  type: string;
  details: Record<string, unknown>;
}

export interface ActivityFeedResponse {
  items: UnifiedActivityItem[];
  next: string | undefined;
  hasMore: boolean;
}

/**
 * Composite cursor for stable pagination across multiple data sources.
 * Encodes: ledger (64-bit), tx index (32-bit), op index (32-bit), source (string).
 * This ensures deterministic ordering even when events happen in the same ledger.
 */
export interface CompositeCursor {
  ledger: number;
  txIndex: number;
  opIndex: number;
  source: string; // "horizon" or event ID
}

/**
 * Decodes a base64-encoded composite cursor.
 * Returns null for any malformed input.
 */
export function decodeCompositeCursor(cursorStr?: string): CompositeCursor | null {
  if (!cursorStr) return null;
  try {
    const json = Buffer.from(cursorStr, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    if (
      typeof parsed.ledger === "number" &&
      typeof parsed.txIndex === "number" &&
      typeof parsed.opIndex === "number" &&
      typeof parsed.source === "string"
    ) {
      return {
        ledger: parsed.ledger,
        txIndex: parsed.txIndex,
        opIndex: parsed.opIndex,
        source: parsed.source,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Encodes a composite cursor as a base64 string.
 */
export function encodeCompositeCursor(cursor: CompositeCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64");
}

function parseScValTopic(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === "string") return val;
  if (typeof val === "object" && val !== null && "value" in val) {
    const inner = (val as { value: unknown }).value;
    if (typeof inner === "string") return inner;
  }
  return null;
}

/**
 * Maximum number of ledgers to look back when reconciling retention gaps.
 * RPC typically retains ~7 days of events (~17280 ledgers at 5s per ledger).
 */
const RETENTION_LEDGERS = 17_280;

/**
 * Maximum lag in ledgers before we emit an alert.
 */
const LAG_ALERT_THRESHOLD = 100;

/**
 * Cache Horizon pages per account to avoid redundant RPC calls.
 * Key: account|pageSize, Value: { cursor, items, expiry }
 */
const HORIZON_CACHE_TTL_MS = 60_000; // 60 seconds
const horizonCache = new Map<
  string,
  { items: Array<{ id: string; pagingToken: string; createdAt: string; cursor: string }>; expiry: number }
>();

/**
 * SSE fanout configuration. All values are read from config with safe defaults
 * so a single-instance deployment keeps working without Redis.
 */
export interface SseFanoutConfig {
  /** Redis channel used to fan out SSE events across instances. */
  channel: string;
  /** Maximum concurrent SSE connections per user. */
  maxPerUser: number;
  /** Maximum concurrent SSE connections across the whole instance. */
  maxGlobal: number;
  /** Interval between heartbeat comments, in ms. */
  heartbeatMs: number;
  /** Close a connection after this many ms without a successful write. */
  idleTimeoutMs: number;
}

const DEFAULT_SSE_CONFIG: SseFanoutConfig = {
  channel: "sse:activity-feed",
  maxPerUser: 5,
  maxGlobal: 1_000,
  heartbeatMs: 25_000,
  idleTimeoutMs: 120_000,
};

function readPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Resolves SSE fanout configuration from the shared config object.
 * Unknown/missing values fall back to conservative defaults.
 */
export function resolveSseConfig(): SseFanoutConfig {
  const raw = (config as unknown as { sse?: Partial<SseFanoutConfig> }).sse ?? {};
  return {
    channel: typeof raw.channel === "string" && raw.channel.length > 0 ? raw.channel : DEFAULT_SSE_CONFIG.channel,
    maxPerUser: readPositiveInt(raw.maxPerUser, DEFAULT_SSE_CONFIG.maxPerUser),
    maxGlobal: readPositiveInt(raw.maxGlobal, DEFAULT_SSE_CONFIG.maxGlobal),
    heartbeatMs: readPositiveInt(raw.heartbeatMs, DEFAULT_SSE_CONFIG.heartbeatMs),
    idleTimeoutMs: readPositiveInt(raw.idleTimeoutMs, DEFAULT_SSE_CONFIG.idleTimeoutMs),
  };
}

/**
 * Stable error codes for SSE connection admission. These are surfaced through
 * the shared error envelope so clients can react deterministically.
 */
export const SSE_ERROR_CODES = {
  perUserLimit: "SSE_PER_USER_LIMIT",
  globalLimit: "SSE_GLOBAL_LIMIT",
  idleTimeout: "SSE_IDLE_TIMEOUT",
} as const;

export type SseErrorCode = (typeof SSE_ERROR_CODES)[keyof typeof SSE_ERROR_CODES];

/**
 * Minimal subscriber surface so the fanout can be unit-tested without a live
 * Redis client. A real ioredis client satisfies this shape.
 */
export interface SseSubscriber {
  subscribe(channel: string): Promise<unknown>;
  on(event: "message", listener: (channel: string, message: string) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
  quit?(): Promise<unknown>;
}

/**
 * Minimal publisher surface. A real ioredis client satisfies this shape.
 */
export interface SsePublisher {
  publish(channel: string, message: string): Promise<number>;
}

/**
 * A single SSE connection. `write` returns false when the socket is closed or
 * backpressured, which the registry treats as a dead connection.
 */
export interface SseConnection {
  userId: string;
  write(chunk: string): boolean;
  close(code: SseErrorCode): void;
}

interface RegisteredConnection {
  conn: SseConnection;
  lastWriteAt: number;
  heartbeat: ReturnType<typeof setInterval>;
}

/**
 * Tracks live SSE connections per instance, enforces per-user and global
 * limits, and drives heartbeats / idle timeouts.
 */
export class SseConnectionRegistry {
  private readonly byUser = new Map<string, Set<RegisteredConnection>>();
  private readonly all = new Set<RegisteredConnection>();

  constructor(private readonly cfg: SseFanoutConfig = resolveSseConfig()) {}

  get size(): number {
    return this.all.size;
  }

  userCount(userId: string): number {
    return this.byUser.get(userId)?.size ?? 0;
  }

  /**
   * Attempts to register a connection. Returns the stable error code when the
   * per-user or global limit is exceeded, otherwise null on success.
   */
  register(conn: SseConnection): SseErrorCode | null {
    if (this.all.size >= this.cfg.maxGlobal) {
      return SSE_ERROR_CODES.globalLimit;
    }
    if (this.userCount(conn.userId) >= this.cfg.maxPerUser) {
      return SSE_ERROR_CODES.perUserLimit;
    }

    const entry: RegisteredConnection = {
      conn,
      lastWriteAt: Date.now(),
      heartbeat: setInterval(() => this.tick(entry), this.cfg.heartbeatMs),
    };
    if (typeof entry.heartbeat.unref === "function") entry.heartbeat.unref();

    this.all.add(entry);
    let set = this.byUser.get(conn.userId);
    if (!set) {
      set = new Set();
      this.byUser.set(conn.userId, set);
    }
    set.add(entry);
    return null;
  }

  unregister(conn: SseConnection): void {
    for (const entry of this.all) {
      if (entry.conn === conn) {
        this.remove(entry);
        return;
      }
    }
  }

  /**
   * Delivers a serialized event to every connection owned by `userId`.
   * Returns the number of connections that accepted the write.
   */
  deliver(userId: string, payload: string): number {
    const set = this.byUser.get(userId);
    if (!set) return 0;
    let delivered = 0;
    for (const entry of Array.from(set)) {
      if (this.write(entry, payload)) delivered += 1;
    }
    return delivered;
  }

  /** Broadcasts a serialized event to every live connection. */
  broadcast(payload: string): number {
    let delivered = 0;
    for (const entry of Array.from(this.all)) {
      if (this.write(entry, payload)) delivered += 1;
    }
    return delivered;
  }

  /** Closes every connection and clears timers. Used on shutdown. */
  closeAll(): void {
    for (const entry of Array.from(this.all)) {
      this.remove(entry);
      entry.conn.close(SSE_ERROR_CODES.idleTimeout);
    }
  }

  private write(entry: RegisteredConnection, payload: string): boolean {
    try {
      const ok = entry.conn.write(payload);
      if (!ok) {
        this.remove(entry);
        return false;
      }
      entry.lastWriteAt = Date.now();
      return true;
    } catch {
      this.remove(entry);
      return false;
    }
  }

  private tick(entry: RegisteredConnection): void {
    if (!this.all.has(entry)) return;
    if (Date.now() - entry.lastWriteAt > this.cfg.idleTimeoutMs) {
      this.remove(entry);
      entry.conn.close(SSE_ERROR_CODES.idleTimeout);
      return;
    }
    // SSE comment line keeps proxies from closing idle streams.
    this.write(entry, ": heartbeat\n\n");
  }

  private remove(entry: RegisteredConnection): void {
    clearInterval(entry.heartbeat);
    this.all.delete(entry);
    const set = this.byUser.get(entry.conn.userId);
    if (set) {
      set.delete(entry);
      if (set.size === 0) this.byUser.delete(entry.conn.userId);
    }
  }
}

/**
 * Serializes an activity item for SSE delivery. Amounts are kept as strings so
 * precision is never lost in transit.
 */
export function serializeSseEvent(item: UnifiedActivityItem): string {
  return `event: activity\ndata: ${JSON.stringify(item)}\n\n`;
}

/**
 * Publishes an activity item to the Redis fanout channel so every instance can
 * deliver it to its local subscribers. Falls back to local-only delivery when
 * no publisher is configured (single-instance deployments).
 */
export async function publishActivityEvent(
  item: UnifiedActivityItem,
  publisher?: SsePublisher,
  cfg: SseFanoutConfig = resolveSseConfig()
): Promise<void> {
  if (!publisher) return;
  try {
    await publisher.publish(cfg.channel, JSON.stringify(item));
  } catch (err) {
    console.error("[activity-feed] failed to publish SSE event", err);
  }
}

/**
 * Subscribes the local registry to the Redis fanout channel. Events published
 * by any instance are delivered to matching local connections. Returns a
 * cleanup function that unsubscribes and stops delivery.
 */
export async function subscribeActivityFanout(
  registry: SseConnectionRegistry,
  subscriber: SseSubscriber,
  cfg: SseFanoutConfig = resolveSseConfig()
): Promise<() => Promise<void>> {
  const onMessage = (_channel: string, message: string) => {
    let item: UnifiedActivityItem;
    try {
      item = JSON.parse(message) as UnifiedActivityItem;
    } catch {
      console.warn("[activity-feed] dropping malformed SSE fanout message");
      return;
    }
    if (!item || typeof item.id !== "string" || typeof item.source !== "string") {
      console.warn("[activity-feed] dropping SSE fanout message with invalid shape");
      return;
    }
    const payload = serializeSseEvent(item);
    const userId = (item.details as { userId?: unknown } | undefined)?.userId;
    if (typeof userId === "string" && userId.length > 0) {
      registry.deliver(userId, payload);
    } else {
      registry.broadcast(payload);
    }
  };

  subscriber.on("message", onMessage);
  subscriber.on("error", (err) => {
    console.error("[activity-feed] SSE fanout subscriber error", err);
  });
  await subscriber.subscribe(cfg.channel);

  return async () => {
    if (subscriber.quit) {
      await subscriber.quit();
    }
  };
}

/**
 * Ensures the activity feed database tables exist.
 * Must be called during app initialization.
 */
export async function ensureActivityFeedTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_feed_events (
      id BIGSERIAL PRIMARY KEY,
      event_id VARCHAR(255) NOT NULL UNIQUE,
      contract_id VARCHAR(56) NOT NULL,
      ledger BIGINT NOT NULL,
      ledger_closed_at TIMESTAMPTZ,
      topic0 TEXT,
      topic1 TEXT,
      value_json JSONB NOT NULL,
      tx_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS activity_feed_events_contract_id_idx
      ON activity_feed_events (contract_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS activity_feed_events_ledger_idx
      ON activity_feed_events (ledger)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_feed_cursor (
      id BIGSERIAL PRIMARY KEY,
      contract_id VARCHAR(56) NOT NULL UNIQUE,
      last_event_id VARCHAR(255) NOT NULL DEFAULT '',
      last_ledger BIGINT NOT NULL DEFAULT 0,
      last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_feed_alerts (
      id BIGSERIAL PRIMARY KEY,
      alert_type VARCHAR(32) NOT NULL,
      contract_id VARCHAR(56),
      message TEXT NOT NULL,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS activity_feed_alerts_created_at_idx
      ON activity_feed_alerts (created_at)
  `);
}

/**
 * Commits events to the database with idempotent upserts.
 * All-or-nothing transaction: either all events are committed or none are.
 */
async function commitEvents(
  contractId: string,
  events: Array<{
    id: string;
    ledger: number;
    ledgerClosedAt?: string;
    topic: unknown[];
    value: unknown;
    txHash?: string;
  }>
): Promise<void> {
  if (events.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const ev of events) {
      const topic0 = parseScValTopic(ev.topic?.[0]) ?? "";
      const topic1 = parseScValTopic(ev.topic?.[1]) ?? "";

      await client.query(
        `
        INSERT INTO activity_feed_events (
          event_id,
          contract_id,
          ledger,
          ledger_closed_at,
          topic0,
          topic1,
          value_json,
          tx_hash
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (event_id) DO NOTHING
        `,
        [
          ev.id,
          contractId,
          ev.ledger,
          ev.ledgerClosedAt ?? null,
          topic0,
          topic1,
          JSON.stringify(ev.value),
          ev.txHash ?? null,
        ]
      );
    }

    await client.query("COMMIT");
    console.log(`[activity-feed] committed ${events.length} event(s) for ${contractId}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Gets the current cursor position for a contract from the database.
 */
async function getCursor(contractId: string): Promise<{ lastEventId: string; lastLedger: number }> {
  const result = await pool.query(
    `SELECT last_event_id, last_ledger FROM activity_feed_cursor WHERE contract_id = $1`,
    [contractId]
  );

  if (result.rows.length > 0) {
    return {
      lastEventId: result.rows[0].last_event_id,
      lastLedger: Number(result.rows[0].last_ledger),
    };
  }

  // No cursor found - use config or start from ledger 1
  const startLedger = config.INDEXER_START_LEDGER || 1;
  return {
    lastEventId: "",
    lastLedger: startLedger,
  };
}

/**
 * Updates the cursor after successfully processing events.
 * Commits cursor and events in the same transaction for durability.
 */
async function updateCursor(
  contractId: string,
  lastEventId: string,
  lastLedger: number
): Promise<void> {
  await pool.query(
    `
    INSERT INTO activity_feed_cursor (contract_id, last_event_id, last_ledger, last_checked_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (contract_id)
    DO UPDATE SET
      last_event_id = EXCLUDED.last_event_id,
      last_ledger = EXCLUDED.last_ledger,
      last_checked_at = NOW()
    `,
    [contractId, lastEventId, lastLedger]
  );
}

/**
 * Logs a lag alert. Only logs once per gap to avoid alert storms.
 */
function logLagAlert(contractId: string, gapLedgers: number, currentLedger: number): void {
  const key = `lag-alert:${contractId}:${currentLedger}`;
  console.warn(
    `[activity-feed] lag alert for ${contractId}: ${gapLedgers} ledgers behind (current: ${currentLedger})`
  );
}

/**
 * Reconciles state when cursor falls behind RPC retention.
 * Uses getLedgerEntries to find the latest state and rebuilds the cursor.
 */
async function reconcileState(contractId: string, server: StellarSdk.rpc.Server): Promise<void> {
  console.log(`[activity-feed] reconciling state for ${contractId}`);

  // Get the latest ledger from RPC
  const latestLedger = await server.getLatestLedger();
  const latestSequence = latestLedger.sequence;

  // Get the current cursor
  const cursor = await getCursor(contractId);

  // Calculate
}
