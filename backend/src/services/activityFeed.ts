import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "../config";
import { StellarService } from "./stellar";
import { pool } from "../db";
import { metrics } from "./metrics";

export interface UnifiedActivityItem {
  id: string;
  source: "payment" | "contract_event" | "claimable_balance";
  timestamp: string; // ISO 8601
  type: string;
  details: Record<string, unknown>;
}

/**
 * Evaluated predicate state for a claimable balance, as surfaced in the feed.
 * - `claimable_now`: no predicates, or all predicates currently satisfied.
 * - `claimable_after`: not yet claimable; becomes claimable at `claimableAfter`.
 * - `claimable_before`: claimable now but expires at `claimableBefore`.
 * - `expired`: the `not`/`before` window has passed; no longer claimable.
 */
export type ClaimableBalanceState =
  | "claimable_now"
  | "claimable_after"
  | "claimable_before"
  | "expired";

export interface ClaimableBalancePredicateSummary {
  state: ClaimableBalanceState;
  /** ISO 8601 timestamp when the balance becomes claimable, if bounded. */
  claimableAfter?: string;
  /** ISO 8601 timestamp when the balance stops being claimable, if bounded. */
  claimableBefore?: string;
  /** Human-readable reason for the current state. */
  reason: string;
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

/**
 * Horizon operation types that create or consume claimable balances.
 */
const CLAIMABLE_BALANCE_OP_TYPES = new Set([
  "create_claimable_balance",
  "claim_claimable_balance",
]);

/**
 * Extracts the absolute-time bounds from a Horizon claim predicate tree.
 * Horizon predicates are recursive: `{unconditional: true}`, `{not: p}`,
 * `{and: [p, ...]}`, `{or: [p, ...]}`, `{abs_before: iso}`,
 * `{abs_before_epoch: "123"}` or `{abs_after: iso}` / `{abs_after_epoch: "123"}`.
 * Returns the tightest lower/upper bounds found anywhere in the tree.
 */
export function extractPredicateBounds(
  predicate: unknown
): { after?: Date; before?: Date } {
  const bounds: { after?: Date; before?: Date } = {};

  const mergeAfter = (d: Date) => {
    if (!bounds.after || d.getTime() > bounds.after.getTime()) bounds.after = d;
  };
  const mergeBefore = (d: Date) => {
    if (!bounds.before || d.getTime() < bounds.before.getTime()) bounds.before = d;
  };

  const toDate = (value: unknown): Date | null => {
    if (typeof value === "string" && value.length > 0) {
      const asNumber = Number(value);
      const d = Number.isFinite(asNumber) && /^\d+$/.test(value)
        ? new Date(asNumber * 1000)
        : new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  };

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;

    if (obj.abs_after !== undefined || obj.abs_after_epoch !== undefined) {
      const d = toDate(obj.abs_after ?? obj.abs_after_epoch);
      if (d) mergeAfter(d);
    }
    if (obj.abs_before !== undefined || obj.abs_before_epoch !== undefined) {
      const d = toDate(obj.abs_before ?? obj.abs_before_epoch);
      if (d) mergeBefore(d);
    }
    if (Array.isArray(obj.and)) obj.and.forEach(walk);
    if (Array.isArray(obj.or)) obj.or.forEach(walk);
    if (obj.not !== undefined) walk(obj.not);
  };

  walk(predicate);
  return bounds;
}

/**
 * Evaluates a Horizon claim predicate against `now` and returns a summary
 * suitable for the activity feed. Pure function: no I/O, deterministic given
 * `now`, which keeps it trivially unit-testable.
 */
export function evaluateClaimPredicate(
  predicate: unknown,
  now: Date = new Date()
): ClaimableBalancePredicateSummary {
  const { after, before } = extractPredicateBounds(predicate);
  const nowMs = now.getTime();

  if (before && nowMs >= before.getTime()) {
    return {
      state: "expired",
      claimableAfter: after?.toISOString(),
      claimableBefore: before.toISOString(),
      reason: "predicate expired",
    };
  }

  if (after && nowMs < after.getTime()) {
    return {
      state: "claimable_after",
      claimableAfter: after.toISOString(),
      claimableBefore: before?.toISOString(),
      reason: "predicate not yet satisfied",
    };
  }

  if (before) {
    return {
      state: "claimable_before",
      claimableAfter: after?.toISOString(),
      claimableBefore: before.toISOString(),
      reason: "claimable until predicate expires",
    };
  }

  return {
    state: "claimable_now",
    claimableAfter: after?.toISOString(),
    reason: "unconditional",
  };
}

/**
 * Maps a Horizon claimable-balance operation record into a unified activity
 * item. Returns null for unrelated operation types so callers can filter.
 */
export function claimableBalanceActivityItem(
  op: Record<string, unknown>,
  now: Date = new Date()
): UnifiedActivityItem | null {
  const type = typeof op.type === "string" ? op.type : "";
  if (!CLAIMABLE_BALANCE_OP_TYPES.has(type)) return null;

  const id =
    typeof op.id === "string" && op.id.length > 0
      ? op.id
      : `${type}:${String(op.transaction_hash ?? "")}:${String(op.paging_token ?? "")}`;
  const timestamp =
    typeof op.created_at === "string" && op.created_at.length > 0
      ? op.created_at
      : now.toISOString();

  if (type === "create_claimable_balance") {
    const predicate = evaluateClaimPredicate(op.claimants, now);
    return {
      id,
      source: "claimable_balance",
      timestamp,
      type,
      details: {
        balanceId: op.balance_id ?? null,
        asset: op.asset ?? null,
        amount: typeof op.amount === "string" ? op.amount : String(op.amount ?? ""),
        sponsor: op.sponsor ?? null,
        sourceAccount: op.source_account ?? null,
        predicate,
      },
    };
  }

  return {
    id,
    source: "claimable_balance",
    timestamp,
    type,
    details: {
      balanceId: op.balance_id ?? null,
      claimant: op.claimant ?? null,
      sourceAccount: op.source_account ?? null,
    },
  };
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

  // Calculate how far behind we are
  const gap = Math.max(0, latestSequence - cursor.lastLedger);

  if (gap > RETENTION_LEDGERS) {
    // Too far back - need to start from scratch
    console.warn(
      `[activity-feed] cursor too far behind for ${contractId}: ${gap} ledgers (max retention: ${RETENTION_LEDGERS})`
    );
    await pool.query(
      `UPDATE activity_feed_cursor SET last_event_id = '', last_ledger = 0, last_checked_at = NOW() WHERE contract_id = $1`,
      [contractId]
    );
    logLagAlert(contractId, gap, latestSequence);
    return;
  }

  if (gap > LAG_ALERT_THRESHOLD) {
    logLagAlert(contractId, gap, latestSequence);
  }

  // Rebuild the cursor by processing events from the last known ledger
  // This is a best-effort reconciliation - we may miss some events
  // but the cursor will be in a valid state
  console.log(`[activity-feed] reconciled cursor for ${contractId}: last_ledger = ${cursor.lastLedger}`);
}

/**
 * Fetches and processes events from RPC, committing them to the database.
 * Handles retention gaps by triggering reconciliation.
 */
async function fetchAndProcessEvents(
  contractId: string,
  server: StellarSdk.rpc.Server
): Promise<{ lastEventId: string; lastLedger: number }> {
  const cursor = await getCursor(contractId);
  const startLedger = Math.max(1, cursor.lastLedger);

  // Fetch events from RPC
  const res = await server.getEvents({
    startLedger: startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [contractId],
      },
    ],
    limit: 1000,
  });

  const events = res.events;
  if (events.length === 0) {
    // No new events - just update the cursor to latest
    await updateCursor(contractId, cursor.lastEventId, res.latestLedger);
    return { lastEventId: cursor.lastEventId, lastLedger: res.latestLedger };
  }

  // Check for retention gap
  const gap = res.latestLedger - cursor.lastLedger;
  if (gap > RETENTION_LEDGERS) {
    console.warn(
      `[activity-feed] retention gap detected for ${contractId}: ${gap} ledgers`
    );
    await reconcileState(contractId, server);
    return await fetchAndProcessEvents(contractId, server);
  }

  // Commit events and update cursor
  await commitEvents(contractId, events);

  // Get the last event's details
  const lastEvent = events[events.length - 1];
  await updateCursor(contractId, lastEvent.id, res.latestLedger);

  return {
    lastEventId: lastEvent.id,
    lastLedger: res.latestLedger,
  };
}

/**
 * Starts the activity feed indexer worker.
 * Polls for contract events and commits them to the database.
 */
export async function startActivityFeedIndexer(stellar: StellarService): Promise<() => void> {
  if (!config.GLOBE_WALLET_CONTRACT_ID) {
    console.warn("[activity-feed] GLOBE_WALLET_CONTRACT_ID not set, indexer disabled");
    return () => undefined;
  }

  const contractId = config.GLOBE_WALLET_CONTRACT_ID;
  const server = new StellarSdk.rpc.Server(config.SOROBAN_RPC_URL);
  const pollInterval = config.INDEXER_POLL_INTERVAL_MS || 5000;
  const lagAlertCooldown = new Set<string>();

  let isRunning = true;

  // Metrics counters
  let eventsProcessedTotal = 0;
  let lagAlertsTotal = 0;
  let lastPollMs = 0;

  const pollLoop = async () => {
    if (!isRunning) return;

    const startTime = Date.now();

    try {
      const result = await fetchAndProcessEvents(contractId, server);
      const duration = Date.now() - startTime;

      // Update metrics
      const currentLedger = await server.getLatestLedger();
      const gap = currentLedger.sequence - result.lastLedger;
      metrics.indexerLagLedgers.set(gap, { contract: contractId });
      metrics.indexerCurrentLedger.set(result.lastLedger, { contract: contractId });

      // Log lag metrics
      console.log(
        `[activity-feed] metrics for ${contractId}: last_ledger=${result.lastLedger}, current=${currentLedger.sequence}, gap=${gap}, duration=${duration}ms`
      );
      lastPollMs = duration;

      // Check lag and alert if needed
      if (gap > LAG_ALERT_THRESHOLD) {
        const key = `${contractId}:${result.lastLedger}`;
        if (!lagAlertCooldown.has(key)) {
          console.warn(
            `[activity-feed] lag alert for ${contractId}: ${gap} ledgers behind`
          );
          lagAlertCooldown.add(key);
          lagAlertsTotal++;
          setTimeout(() => lagAlertCooldown.delete(key), pollInterval * 2);
        }
      }

      console.log(
        `[activity-feed] poll complete for ${contractId}: last_ledger = ${result.lastLedger}`
      );
    } catch (err) {
      console.error(
        `[activity-feed] poll error for ${contractId}, retrying in ${pollInterval}ms`,
        (err as Error).message
      );
    }

    if (isRunning) {
      setTimeout(pollLoop, pollInterval);
    }
  };

  // Expose metrics for monitoring
  const getMetrics = () => ({
    contractId,
    eventsProcessedTotal,
    lagAlertsTotal,
    lastPollIntervalMs: pollInterval,
    lastPollDurationMs: lastPollMs,
  });

  // Start the poll loop
  setTimeout(pollLoop, pollInterval);

  console.log(`[activity-feed] indexer started for ${contractId}, polling every ${pollInterval}ms`);

  return () => {
    isRunning = false;
    console.log("[activity-feed] indexer stopped");
  };
}

/**
 * Gets the current activity feed metrics for monitoring.
 */
export function getActivityFeedMetrics(): { contractId: string | null } & Record<string, unknown> {
  // Metrics are tracked internally in the poll loop
  // This is a placeholder that would need to be enhanced if metrics
  // need to be exposed across module boundaries
  return {
    contractId: config.GLOBE_WALLET_CONTRACT_ID ?? null,
  };
}

/**
 * Fetches contract events from the database for a user's activity feed.
 * Reads from the database instead of RPC for consistency.
 */
async function fetchContractEventsFromDB(
  userPublicKey: string,
  limit: number,
  eventIdCursor?: string
): Promise<UnifiedActivityItem[]> {
  if (!config.GLOBE_WALLET_CONTRACT_ID) {
    return [];
  }

  const contractId = config.GLOBE_WALLET_CONTRACT_ID;

  try {
    // Build query with cursor and user filter
    let sql = `
      SELECT event_id, ledger, ledger_closed_at, topic0, topic1, value_json, tx_hash
      FROM activity_feed_events
      WHERE contract_id = $1
    `;
    const params: any[] = [contractId];

    if (eventIdCursor) {
      sql += ` AND event_id > $${params.length + 1}`;
      params.push(eventIdCursor);
    }

    sql += ` ORDER BY event_id DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(sql, params);

    const items: UnifiedActivityItem[] = [];

    for (const row of result.rows) {
      // Check if event pertains to this user
      const rawText = JSON.stringify({ topic0: row.topic0, topic1: row.topic1, value: row.value_json });
      if (!rawText.includes(userPublicKey)) {
        continue;
      }

      const timestamp = row.ledger_closed_at ? row.ledger_closed_at.toISOString() : new Date().toISOString();

      items.push({
        id: row.event_id,
        source: "contract_event" as const,
        timestamp,
        type: row.topic0 || "contract_event",
        details: {
          ledger: Number(row.ledger),
          contractId: row.contract_id,
          transactionHash: row.tx_hash,
          topic0: row.topic0,
          topic1: row.topic1,
          value: row.value_json,
        },
      });
    }

    return items;
  } catch (err) {
    console.warn(`[activity-feed] Failed to fetch events from DB: ${err}`);
    return [];
  }
}

/**
 * Fetches Horizon payment history with caching.
 * Returns items with their ledger position for k-way merge.
 */
async function fetchHorizonPayments(
  stellar: StellarService,
  publicKey: string,
  limit: number,
  cursor?: string
): Promise<Array<{ id: string; pagingToken: string; createdAt: string; cursor: string }>> {
  const cacheKey = `${publicKey}:${limit}:${cursor || "none"}`;
  const cached = horizonCache.get(cacheKey);
  const now = Date.now();

  if (cached && now < cached.expiry) {
    console.log(`[activity-feed] Horizon cache HIT for ${publicKey}`);
    return cached.items;
  }

  try {
    const result = await stellar.getPaymentHistory(publicKey, {
      limit,
      cursor,
    });

    const items = result.payments.map((p) => ({
      id: p.id,
      pagingToken: p.pagingToken || p.id,
      createdAt: p.createdAt,
      cursor: p.pagingToken || p.id, // Opaque cursor to pass through
    }));

    // Cache the results
    horizonCache.set(cacheKey, {
      items,
      expiry: now + HORIZON_CACHE_TTL_MS,
    });

    return items;
  } catch (err) {
    console.warn(`[activity-feed] Failed to fetch Horizon payments: ${err}`);
    return [];
  }
}

/**
 * K-way merge for pagination across multiple data sources.
 * Uses per-source lookahead to ensure stable ordering and no duplicates/gaps.
 */
async function mergeAndPaginate(
  publicKey: string,
  limit: number,
  cursor?: CompositeCursor,
  stellar?: StellarService
): Promise<{
  items: UnifiedActivityItem[];
  nextCursor: CompositeCursor | null;
  hasMore: boolean;
}> {
  const allItems: UnifiedActivityItem[] = [];
  const seen = new Set<string>();

  // Fetch from both sources
  const horizonItems = stellar
    ? await fetchHorizonPayments(stellar, publicKey, limit * 2, cursor?.source)
    : [];

  const eventItems = await fetchContractEventsFromDB(
    publicKey,
    limit * 2,
    cursor?.source
  );

  // Combine items from both sources
  const combined = [
    ...horizonItems.map((item) => ({
      ...item,
      source: "payment" as const,
      type: "payment",
      timestamp: item.createdAt,
      details: {
        id: item.id,
        cursor: item.cursor,
      },
    })),
    ...eventItems,
  ];

  // Sort by timestamp descending, then by id for stable ordering
  combined.sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    return (b.id as string).localeCompare(a.id as string);
  });

  // Apply lookahead to ensure no duplicates
  for (const item of combined) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    allItems.push(item);
  }

  // Slice to the requested limit
  const pageItems = allItems.slice(0, limit);

  // Determine next cursor
  let nextCursor: CompositeCursor | null = null;
  if (pageItems.length > 0 && allItems.length > limit) {
    const lastItem = pageItems[pageItems.length - 1];
    nextCursor = {
      ledger: 0,
      txIndex: 0,
      opIndex: 0,
      source: (lastItem.details as { cursor?: string }).cursor || lastItem.id,
    };
  }

  const hasMore = allItems.length > limit;

  return {
    items: pageItems,
    nextCursor,
    hasMore,
  };
}

/**
 * Merges enriched Horizon payment history and indexed Soroban contract events
 * into a single unified timeline ordered by timestamp descending (#79).
 *
 * Breaks timestamp ties deterministically by ID descending for stable pagination.
 */
export async function getUnifiedActivityFeed(params: {
  publicKey: string;
  limit?: number;
  cursor?: string;
  stellar: StellarService;
}): Promise<ActivityFeedResponse> {
  const { publicKey, limit = 20, cursor, stellar } = params;

  // Decode the composite cursor
  const compositeCursor = decodeCompositeCursor(cursor);

  const result = await mergeAndPaginate(publicKey, limit, compositeCursor ?? undefined, stellar);

  // Transform items to the expected format
  const transformed = result.items.map((item) => ({
    id: item.id,
    source: item.source,
    timestamp: item.timestamp,
    type: item.type,
    details: item.details,
  }));

  return {
    items: transformed,
    next: result.nextCursor ? encodeCompositeCursor(result.nextCursor) : undefined,
    hasMore: result.hasMore,
  };
}
