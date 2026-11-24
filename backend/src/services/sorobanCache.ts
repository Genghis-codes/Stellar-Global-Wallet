/**
 * Soroban read-result cache (#86).
 *
 * Each simulate() call is a full RPC round-trip (~100–500 ms). This thin
 * Redis layer caches the JSON-serialised return value keyed by
 * `contractId:method:base64(args)` with a 15-second TTL — short enough
 * that most on-chain state changes are visible within one ledger close
 * (~5 s on testnet/mainnet) plus a comfortable margin, yet long enough
 * to absorb repeated identical reads inside a single user interaction.
 *
 * Invalidation: call `bustContractCache(contractId)` from any indexer or
 * event handler that detects a state-mutating event for the contract.  The
 * bust uses Redis SCAN + DEL so it never blocks the event loop.
 *
 * Cross-instance invalidation: when one backend instance detects a
 * state change, it publishes an invalidation message to Redis pub/sub.
 * All instances (including the sender) subscribe to this channel and
 * invalidate their local caches.
 *
 * Read-your-writes: after a transaction is submitted, cache reads for that
 * user's contract interactions are bypassed until the transaction is
 * confirmed on-chain, ensuring users see the effect of their own changes
 * immediately.
 *
 * Cache-hit/miss counts and invalidation events are written to stdout so
 * log-aggregation tools (e.g. Datadog, CloudWatch) can track hit rate
 * and invalidation volume without any extra instrumentation library.
 */

import { createClient, RedisClientType } from "redis";
import { config } from "../config";

const CACHE_TTL_SECONDS = 15;
const KEY_PREFIX = `orbit-wal:${config.STELLAR_NETWORK}:soroban-cache:`;
const PUBSUB_CHANNEL = `orbit-wal:${config.STELLAR_NETWORK}:soroban-cache:invalidate`;
/** Bounded connect timeout so a Redis outage degrades quickly instead of hanging hot-path calls (#234). */
const REDIS_CONNECT_TIMEOUT_MS = 500;
/** Backoff window after a failed connect before retrying, preventing per-request dial storms. */
const RECONNECT_COOLDOWN_MS = 2_000;

type CacheClient = ReturnType<typeof createClient>;

let _client: CacheClient | undefined;
let _pubsubClient: RedisClientType | undefined;
let _connectPromise: Promise<void> | null = null;
let _lastConnectFailureAt = 0;

function getClient(): CacheClient {
  if (!_client) {
    _client = createClient({
      url: config.REDIS_URL,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
        reconnectStrategy: false,
      },
    });
    (_client as unknown as RedisClientType).on("error", (err: Error) => {
      console.error("[soroban-cache] redis error", err.message);
    });
  }
  return _client;
}

async function ensureConnected(): Promise<CacheClient> {
  if (_lastConnectFailureAt > 0 && Date.now() - _lastConnectFailureAt < RECONNECT_COOLDOWN_MS) {
    throw new Error("Redis cache temporarily unavailable (reconnect cooldown)");
  }
  const client = getClient();
  const typed = client as unknown as RedisClientType;
  if (typed.isReady) {
    return client;
  }
  if (!_connectPromise) {
    _connectPromise = (async () => {
      try {
        await client.connect();
        _lastConnectFailureAt = 0;
      } catch (err) {
        _lastConnectFailureAt = Date.now();
        _client = undefined;
        throw err;
      } finally {
        _connectPromise = null;
      }
    })();
  }
  await _connectPromise;
  return client;
}

function buildKey(contractId: string, method: string, args: string): string {
  return `${KEY_PREFIX}${contractId}:${method}:${args}`;
}

/**
 * Track users with pending transactions to implement read-your-writes.
 * Key: userPublicKey, Value: expiry timestamp (ms).
 */
const PENDING_TX_USER_PREFIX = `orbit-wal:${config.STELLAR_NETWORK}:soroban-cache:pending-tx:`;

/** TTL for pending transaction flags (5 minutes). */
const PENDING_TX_TTL_MS = 5 * 60 * 1000;

/**
 * Broadcasts an invalidation message to all backend instances via Redis pub/sub.
 * Each instance (including the sender) will invalidate the contract's cache entries.
 */
async function broadcastInvalidation(contractId: string): Promise<void> {
  try {
    const pubsub = getPubSubClient();
    if (!(pubsub as RedisClientType).isOpen) {
      await pubsub.connect();
    }
    await pubsub.publish(PUBSUB_CHANNEL, JSON.stringify({ contractId, timestamp: Date.now() }));
    console.log(`[soroban-cache] broadcast invalidation for ${contractId}`);
  } catch (err) {
    console.error("[soroban-cache] broadcastInvalidation error", (err as Error).message);
  }
}

/**
 * Returns a Redis client configured for pub/sub operations.
 * Separated from the main client to avoid interfering with regular commands.
 */
function getPubSubClient(): RedisClientType {
  if (!_pubsubClient) {
    _pubsubClient = createClient({ url: config.REDIS_URL });
    _pubsubClient.on("error", (err: Error) => {
      console.error("[soroban-cache] redis pubsub error", err.message);
    });
  }
  return _pubsubClient;
}

/** Handles one invalidation message received from another instance. */
function handleInvalidationMessage(message: string): void {
  try {
    const { contractId, timestamp } = JSON.parse(message);
    console.log(`[soroban-cache] received invalidation for ${contractId} (broadcast at ${timestamp})`);
    bustContractCache(contractId).catch(() => {
      /* Swallow errors to prevent blocking the pub/sub handler */
    });
  } catch (err) {
    console.error("[soroban-cache] failed to parse invalidation message", (err as Error).message);
  }
}

/** Dedicated subscriber connection: a subscribed Redis client can't also publish. */
let _subscriberClient: RedisClientType | null = null;

/**
 * Starts listening for cross-instance invalidation messages.
 * Call this once at application startup.
 */
export async function startInvalidationListener(): Promise<void> {
  try {
    if (!_subscriberClient) {
      _subscriberClient = getPubSubClient().duplicate();
      _subscriberClient.on("error", (err: Error) => {
        console.error("[soroban-cache] redis subscriber error", err.message);
      });
    }
    if (!_subscriberClient.isOpen) {
      await _subscriberClient.connect();
    }
    await _subscriberClient.subscribe(PUBSUB_CHANNEL, handleInvalidationMessage);
    console.log("[soroban-cache] started listening for invalidation messages");
  } catch (err) {
    console.error("[soroban-cache] failed to start invalidation listener", (err as Error).message);
  }
}

/**
 * Marks a user's contract reads as needing fresh data (bypass cache).
 * Used after a transaction is submitted to implement read-your-writes semantics.
 * The flag expires after PENDING_TX_TTL_MS (5 minutes) to cover worst-case
 * confirmation delays.
 */
export async function markPendingTransaction(userPublicKey: string): Promise<void> {
  try {
    const client = await ensureConnected();
    const key = `${PENDING_TX_USER_PREFIX}${userPublicKey}`;
    await client.set(key, "1", { EX: Math.ceil(PENDING_TX_TTL_MS / 1000) });
  } catch (err) {
    console.error("[soroban-cache] markPendingTransaction error", (err as Error).message);
  }
}

/**
 * Returns true if reads for this user should bypass the cache (read-your-writes).
 */
export async function hasPendingTransaction(userPublicKey: string): Promise<boolean> {
  try {
    const client = await ensureConnected();
    const key = `${PENDING_TX_USER_PREFIX}${userPublicKey}`;
    return (await client.exists(key)) === 1;
  } catch (err) {
    console.error("[soroban-cache] hasPendingTransaction error", (err as Error).message);
    return false;
  }
}

/**
 * Clears the pending transaction flag for a user.
 * Call this after a transaction is confirmed on-chain.
 */
export async function clearPendingTransaction(userPublicKey: string): Promise<void> {
  try {
    const client = await ensureConnected();
    const key = `${PENDING_TX_USER_PREFIX}${userPublicKey}`;
    await client.del(key);
  } catch (err) {
    console.error("[soroban-cache] clearPendingTransaction error", (err as Error).message);
  }
}

/**
 * Returns the cached result for a simulate() call, or null on a miss.
 * `argsKey` should be a stable, compact representation of the call's
 * XDR args (e.g. base64-encoded).
 */
export async function getCachedSimulate<T>(
  contractId: string,
  method: string,
  argsKey: string,
  userPublicKey?: string
): Promise<T | null> {
  try {
    const client = await ensureConnected();
    const key = buildKey(contractId, method, argsKey);

    // Read-your-writes: bypass cache if this user has a pending transaction
    if (userPublicKey && (await hasPendingTransaction(userPublicKey))) {
      console.log(`[soroban-cache] BYPASS (pending tx) ${contractId}.${method}`);
      return null;
    }

    const raw = await client.get(key);
    if (raw === null) {
      console.log(`[soroban-cache] MISS ${contractId}.${method}`);
      return null;
    }
    console.log(`[soroban-cache] HIT  ${contractId}.${method}`);
    return JSON.parse(raw) as T;
  } catch (err) {
    // Cache failures must never break the hot path — log and fall through.
    console.error("[soroban-cache] getCachedSimulate error", (err as Error).message);
    return null;
  }
}

/**
 * Stores a simulate() result.  Failures are swallowed so a Redis outage
 * degrades gracefully to un-cached behaviour.
 */
export async function setCachedSimulate(
  contractId: string,
  method: string,
  argsKey: string,
  value: unknown
): Promise<void> {
  try {
    const client = await ensureConnected();
    await client.set(buildKey(contractId, method, argsKey), JSON.stringify(value), {
      EX: CACHE_TTL_SECONDS,
    });
  } catch (err) {
    console.error("[soroban-cache] setCachedSimulate error", (err as Error).message);
  }
}

/**
 * Invalidates all cached entries for a given contract.  Called by the
 * indexer/event handler when a state-mutating event is observed.
 *
 * Uses SCAN instead of KEYS to avoid blocking the Redis event loop on
 * large keyspaces.
 */
export async function bustContractCache(contractId: string): Promise<void> {
  try {
    const client = await ensureConnected();
    const pattern = `${KEY_PREFIX}${contractId}:*`;
    // node-redis >= 5 SCAN takes and returns the cursor as a string
    // ("0" starts and ends the iteration) and returns { cursor, keys }.
    let cursor = "0";
    let busted = 0;
    do {
      const reply = await (client as unknown as RedisClientType).scan(cursor, {
        MATCH: pattern,
        COUNT: 100,
      });
      cursor = reply.cursor;
      if (reply.keys.length > 0) {
        await (client as unknown as RedisClientType).del(reply.keys);
        busted += reply.keys.length;
      }
    } while (cursor !== "0");
    console.log(`[soroban-cache] busted ${busted} key(s) for contract ${contractId}`);
    // Broadcast to other instances
    await broadcastInvalidation(contractId);
  } catch (err) {
    console.error("[soroban-cache] bustContractCache error", (err as Error).message);
  }
}
