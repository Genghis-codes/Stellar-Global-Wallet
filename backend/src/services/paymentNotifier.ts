/**
 * Incoming-payment notification worker (#88, #273).
 *
 * Ingests the global Horizon payment stream once (instead of opening one
 * stream per watched account) and matches each ingested payment against the
 * set of watched accounts.  This scales to large account counts without
 * hitting Horizon's per-account stream limits.
 *
 * Watched-account matching: the set of accounts with at least one registered
 * device is loaded from the DB and indexed in an in-memory bloom filter for a
 * fast negative check.  A bloom-filter hit is confirmed against the DB-backed
 * set so false positives never produce spurious notifications.
 *
 * Cursor persistence & catch-up: the last processed Horizon paging token is
 * persisted in Redis.  On restart the worker resumes from that cursor and
 * catches up on any payments it missed while down.
 *
 * Deduplication: Horizon operation IDs are stored in Redis with a 48-hour
 * TTL.  A second delivery attempt for the same operation ID is a no-op,
 * which prevents double-notifications on stream reconnects.
 *
 * Dust/spam filtering: Payments whose `amount` (converted to float) is
 * below `config.SPAM_DUST_THRESHOLD` are silently dropped (see #105 /
 * paymentFlags.ts for the same threshold).
 *
 * This worker is started once at server boot from index.ts and runs for
 * the lifetime of the process.
 */

import { createClient } from "redis";
import { config } from "../config";
import { withServiceRole } from "../db";
import { getDevicesForAccounts } from "./deviceRegistry";
import { sendPushToAll } from "./pushSender";
import { tNotification } from "./i18nHelper";
import { sendClaimableBalanceEmail } from "./emailNotifier";

const DEDUP_KEY_PREFIX = `orbit-wal:${config.STELLAR_NETWORK}:notif-dedup:payment:`;
const DEDUP_TTL_SECONDS = 48 * 60 * 60; // 48 h
const CURSOR_KEY = `orbit-wal:${config.STELLAR_NETWORK}:notif-cursor:payments`;
// Dedup keys for claimable-balance notifications, keyed per balance id.
const CB_DEDUP_KEY_PREFIX = `orbit-wal:${config.STELLAR_NETWORK}:notif-dedup:claimable-balance:`;
// Claimable balances can live for weeks; keep dedup keys longer than payments.
const CB_DEDUP_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
// How often to scan for balances that are about to expire (ms).
const CB_EXPIRY_SCAN_MS = 15 * 60 * 1000;
// Notify when a balance expires within this window (ms).
const CB_EXPIRY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 h
// Cursor for the claimable-balance ingestion stream.
const CB_CURSOR_KEY = `orbit-wal:${config.STELLAR_NETWORK}:notif-cursor:claimable-balances`;
======
// Horizon streams take cursor='now' to receive only future events.
const STREAM_CURSOR = "now";
// Reconnect delay on stream error (ms).
const RECONNECT_DELAY_MS = 5_000;
// How often to refresh the watched-account set from the DB (ms).
const WATCHED_REFRESH_MS = 5 * 60 * 1000;

let dedupClient: ReturnType<typeof createClient> | undefined;

function getDedupClient() {
  if (!dedupClient) {
    dedupClient = createClient({ url: config.REDIS_URL });
    dedupClient.on("error", (err: Error) =>
      console.error("[payment-notifier] redis error", err.message)
    );
  }
  return dedupClient;
}

async function ensureDedupConnected() {
  const client = getDedupClient();
  if (!client.isOpen) await client.connect();
  return client;
}

/** Returns true the first time `id` is seen, false on duplicates. */
async function markSeen(operationId: string): Promise<boolean> {
  const client = await ensureDedupConnected();
  const key = `${DEDUP_KEY_PREFIX}${operationId}`;
  // SET NX returns "OK" when the key was inserted, null when it already existed.
  const result = await client.set(key, "1", { NX: true, EX: DEDUP_TTL_SECONDS });
  return result === "OK";
}

/**
 * Returns true the first time `(balanceId, kind)` is seen, false on
 * duplicates.  `kind` distinguishes "created" from "expiring" notifications
 * for the same balance.
 */
async function markClaimableBalanceSeen(
  balanceId: string,
  kind: "created" | "expiring"
): Promise<boolean> {
  const client = await ensureDedupConnected();
  const key = `${CB_DEDUP_KEY_PREFIX}${kind}:${balanceId}`;
  const result = await client.set(key, "1", {
    NX: true,
    EX: CB_DEDUP_TTL_SECONDS,
  });
  return result === "OK";
}

/** Reads the persisted claimable-balance ingestion cursor. */
async function loadClaimableBalanceCursor(): Promise<string | null> {
  const client = await ensureDedupConnected();
  return client.get(CB_CURSOR_KEY);
}

/** Persists the claimable-balance ingestion cursor. */
async function saveClaimableBalanceCursor(pagingToken: string): Promise<void> {
  const client = await ensureDedupConnected();
  await client.set(CB_CURSOR_KEY, pagingToken);
}

/** Reads the persisted ingestion cursor, or null if none exists yet. */
async function loadCursor(): Promise<string | null> {
  const client = await ensureDedupConnected();
  return client.get(CURSOR_KEY);
}

/** Persists the ingestion cursor so we can catch up after a restart. */
async function saveCursor(pagingToken: string): Promise<void> {
  const client = await ensureDedupConnected();
  await client.set(CURSOR_KEY, pagingToken);
}

/**
 * Minimal bloom filter used to cheaply reject payments that cannot belong to
 * any watched account.  False positives are acceptable (they are confirmed
 * against the DB-backed set); false negatives are not.
 */
class BloomFilter {
  private readonly bits: Uint8Array;
  private readonly bitCount: number;
  private readonly hashCount: number;

  constructor(expectedItems: number, falsePositiveRate = 0.01) {
    const n = Math.max(expectedItems, 1);
    const m = Math.ceil(-(n * Math.log(falsePositiveRate)) / Math.LN2 ** 2);
    this.bitCount = Math.max(m, 64);
    this.hashCount = Math.max(Math.round((this.bitCount / n) * Math.LN2), 1);
    this.bits = new Uint8Array(Math.ceil(this.bitCount / 8));
  }

  private hashes(value: string): number[] {
    // FNV-1a based double hashing (Kirsch-Mitzenmacher).
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      h1 = (h1 ^ c) * 0x01000193;
      h2 = (h2 + c) * 0x85ebca6b;
    }
    const out: number[] = [];
    for (let i = 0; i < this.hashCount; i++) {
      out.push(Math.abs((h1 + i * h2) % this.bitCount));
    }
    return out;
  }

  add(value: string): void {
    for (const idx of this.hashes(value)) {
      this.bits[idx >> 3] |= 1 << (idx & 7);
    }
  }

  mightContain(value: string): boolean {
    for (const idx of this.hashes(value)) {
      if ((this.bits[idx >> 3] & (1 << (idx & 7))) === 0) return false;
    }
    return true;
  }
}

interface WatchedAccounts {
  filter: BloomFilter;
  set: Set<string>;
}

async function loadWatchedAccounts(): Promise<WatchedAccounts> {
  const { rows } = await withServiceRole(
    (tx) =>
      tx.query<{ account: string }>(`SELECT DISTINCT account FROM devices`),
    { jobName: "paymentNotifier.loadWatchedAccounts" }
  );
  const set = new Set(rows.map((r) => r.account));
  const filter = new BloomFilter(set.size);
  for (const account of set) filter.add(account);
  return { filter, set };
}

/**
 * Starts the payment-notification worker.  This function never returns
 * (it loops forever, reconnecting on errors).  Call it once at startup
 * from index.ts.
 */
export async function startPaymentNotifier(): Promise<void> {
  console.log("[payment-notifier] starting");
  // Claimable-balance notifications run alongside the payment stream.
  void startClaimableBalanceNotifier();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await runStream();
    } catch (err) {
      console.error(
        "[payment-notifier] stream error, reconnecting in",
        RECONNECT_DELAY_MS,
        "ms",
        (err as Error).message
      );
      await sleep(RECONNECT_DELAY_MS);
    }
  }
}

/**
 * Claimable-balance notification loop.  Two responsibilities:
 *  1. Ingest `create_claimable_balance` operations from the global operations
 *     stream and notify watched accounts that are a claimant.
 *  2. Periodically scan watched accounts' claimable balances and notify when
 *     a balance is about to expire (i.e. the absolute-time predicate is near).
 */
async function startClaimableBalanceNotifier(): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await runClaimableBalanceStream();
    } catch (err) {
      console.error(
        "[claimable-balance-notifier] stream error, reconnecting in",
        RECONNECT_DELAY_MS,
        "ms",
        (err as Error).message
      );
      await sleep(RECONNECT_DELAY_MS);
    }
  }
}

async function runClaimableBalanceStream(): Promise<void> {
  const watched = await loadWatchedAccounts();
  if (watched.set.size === 0) {
    await sleep(30_000);
    return;
  }

  console.log(
    `[claimable-balance-notifier] watching ${watched.set.size} account(s)`
  );

  const persistedCursor = await loadClaimableBalanceCursor();
  const startCursor = persistedCursor ?? STREAM_CURSOR;

  const { default: StellarSdk } = await import("@stellar/stellar-sdk");
  const server = new StellarSdk.Horizon.Server(config.HORIZON_URL);

  // Kick off the periodic expiry scan in the background.
  void runExpiryScanLoop(watched);

  await new Promise<void>((resolve, reject) => {
    const close = server
      .operations()
      .cursor(startCursor)
      .stream({
        onmessage: (record) => {
          void (async () => {
            try {
              await handleOperation(watched, record);
              const token = (record as { paging_token?: string }).paging_token;
              if (token) await saveClaimableBalanceCursor(token);
            } catch (err) {
              console.error(
                "[claimable-balance-notifier] handleOperation error",
                (err as Error).message
              );
            }
          })();
        },
        onerror: (err: unknown) => {
          reject(err);
        },
      }) as unknown as () => void;

    void sleep(5 * 60 * 1000).then(() => {
      close();
      resolve();
    });
  });
}

interface HorizonCreateClaimableBalanceRecord {
  id: string;
  type: string;
  paging_token?: string;
  asset?: string;
  amount?: string;
  claimants?: Array<{
    destination?: string;
    predicate?: unknown;
  }>;
}

async function handleOperation(
  watched: WatchedAccounts,
  record: unknown
): Promise<void> {
  const op = record as HorizonCreateClaimableBalanceRecord;
  if (op.type !== "create_claimable_balance") return;
  if (!Array.isArray(op.claimants)) return;

  // The balance id is derived from the operation; Horizon exposes it on the
  // operation record as `balance_id` in newer API versions.
  const balanceId =
    (op as { balance_id?: string }).balance_id ?? op.id;
  if (!balanceId) return;

  const amount = parseFloat(op.amount ?? "0");
  if (amount < config.SPAM_DUST_THRESHOLD) return;

  const assetLabel = formatAssetLabel(op.asset);

  for (const claimant of op.claimants) {
    const account = claimant.destination;
    if (!account) continue;
    if (!watched.filter.mightContain(account)) continue;
    if (!watched.set.has(account)) continue;

    const isNew = await markClaimableBalanceSeen(balanceId, "created");
    if (!isNew) continue;

    await notifyClaimableBalance(account, {
      balanceId,
      amount,
      asset: assetLabel,
      kind: "created",
    });
  }
}

async function runExpiryScanLoop(watched: WatchedAccounts): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await scanExpiringBalances(watched);
    } catch (err) {
      console.error(
        "[claimable-balance-notifier] expiry scan error",
        (err as Error).message
      );
    }
    await sleep(CB_EXPIRY_SCAN_MS);
  }
}

async function scanExpiringBalances(watched: WatchedAccounts): Promise<void> {
  const { default: StellarSdk } = await import("@stellar/stellar-sdk");
  const server = new StellarSdk.Horizon.Server(config.HORIZON_URL);
  const now = Date.now();

  for (const account of watched.set) {
    let page;
    try {
      page = await server.claimableBalances().claimant(account).limit(50).call();
    } catch (err) {
      console.error(
        `[claimable-balance-notifier] failed to list balances for ${account}`,
        (err as Error).message
      );
      continue;
    }

    for (const balance of page.records) {
      const expiry = extractExpiry(balance);
      if (expiry === null) continue;
      const remaining = expiry - now;
      if (remaining <= 0 || remaining > CB_EXPIRY_WINDOW_MS) continue;

      const isNew = await markClaimableBalanceSeen(balance.id, "expiring");
      if (!isNew) continue;

      await notifyClaimableBalance(account, {
        balanceId: balance.id,
        amount: parseFloat(balance.amount ?? "0"),
        asset: formatAssetLabel(balance.asset),
        kind: "expiring",
        expiresAt: new Date(expiry).toISOString(),
      });
    }
  }
}

/**
 * Extracts the earliest absolute-time expiry from a balance's claimants,
 * returning epoch milliseconds or null when no absolute predicate exists.
 */
function extractExpiry(balance: {
  claimants?: Array<{ predicate?: unknown }>;
}): number | null {
  if (!Array.isArray(balance.claimants)) return null;
  let earliest: number | null = null;
  for (const claimant of balance.claimants) {
    const ts = findAbsoluteTime(claimant.predicate);
    if (ts === null) continue;
    if (earliest === null || ts < earliest) earliest = ts;
  }
  return earliest;
}

/** Recursively finds an `abs_before` timestamp (epoch ms) in a predicate. */
function findAbsoluteTime(predicate: unknown): number | null {
  if (!predicate || typeof predicate !== "object") return null;
  const p = predicate as Record<string, unknown>;
  if (typeof p.abs_before === "string") {
    const parsed = Date.parse(p.abs_before);
    return Number.isNaN(parsed) ? null : parsed;
  }
  for (const key of ["and", "or"]) {
    const nested = p[key];
    if (Array.isArray(nested)) {
      for (const child of nested) {
        const ts = findAbsoluteTime(child);
        if (ts !== null) return ts;
      }
    }
  }
  if (p.not) return findAbsoluteTime(p.not);
  return null;
}

function formatAssetLabel(asset: string | undefined): string {
  if (!asset || asset === "native") return "XLM";
  const [code] = asset.split(":");
  return code || "asset";
}

async function notifyClaimableBalance(
  account: string,
  details: {
    balanceId: string;
    amount: number;
    asset: string;
    kind: "created" | "expiring";
    expiresAt?: string;
  }
): Promise<void> {
  const devices = await withServiceRole(
    (tx) => getDevicesForAccounts([account], tx),
    { jobName: "paymentNotifier.notifyClaimableBalance" }
  );
  if (devices.length === 0) return;

  const locale = devices[0]?.locale ?? "en";
  const titleKey =
    details.kind === "created"
      ? "claimableBalance.created.title"
      : "claimableBalance.expiring.title";
  const bodyKey =
    details.kind === "created"
      ? "claimableBalance.created.body"
      : "claimableBalance.expiring.body";

  const bodyParams: Record<string, string> = {
    amount: String(details.amount),
    asset: details.asset,
  };
  if (details.expiresAt) bodyParams.expiresAt = details.expiresAt;

  await sendPushToAll(devices, {
    title: tNotification(titleKey, locale),
    body: tNotification(bodyKey, locale, bodyParams),
    data: {
      type: "claimable_balance",
      balanceId: details.balanceId,
      account,
      amount: details.amount,
      asset: details.asset,
      kind: details.kind,
      ...(details.expiresAt ? { expiresAt: details.expiresAt } : {}),
    },
  });

  // Email is best-effort; failures must not break the notification loop.
  try {
    await sendClaimableBalanceEmail({
      account,
      balanceId: details.balanceId,
      amount: String(details.amount),
      asset: details.asset,
      kind: details.kind,
      expiresAt: details.expiresAt,
      locale,
    });
  } catch (err) {
    console.error(
      "[claimable-balance-notifier] email send failed",
      (err as Error).message
    );
  }

  console.log(
    `[claimable-balance-notifier] notified ${devices.length} device(s) for ${account} balance ${details.balanceId} (${details.kind})`
  );
}

async function runStream(): Promise<void> {
  let watched = await loadWatchedAccounts();
  if (watched.set.size === 0) {
    // No registered devices; wait and retry.
    await sleep(30_000);
    return;
  }

  console.log(
    `[payment-notifier] watching ${watched.set.size} account(s) via global stream`
  );

  // Resume from the persisted cursor for catch-up, otherwise start at 'now'.
  const persistedCursor = await loadCursor();
  const startCursor = persistedCursor ?? STREAM_CURSOR;

  const { default: StellarSdk } = await import("@stellar/stellar-sdk");
  const server = new StellarSdk.Horizon.Server(config.HORIZON_URL);

  let lastRefresh = Date.now();

  await new Promise<void>((resolve, reject) => {
    const close = server
      .payments()
      .cursor(startCursor)
      .stream({
        onmessage: (record) => {
          void (async () => {
            try {
              // Periodically refresh the watched-account set from the DB.
              if (Date.now() - lastRefresh > WATCHED_REFRESH_MS) {
                watched = await loadWatchedAccounts();
                lastRefresh = Date.now();
              }
              await handlePayment(watched, record);
              const token = (record as { paging_token?: string }).paging_token;
              if (token) await saveCursor(token);
            } catch (err) {
              console.error(
                "[payment-notifier] handlePayment error",
                (err as Error).message
              );
            }
          })();
        },
        onerror: (err: unknown) => {
          reject(err);
        },
      }) as unknown as () => void;

    // Keep the worker alive indefinitely; the stream reconnects on error.
    void sleep(5 * 60 * 1000).then(() => {
      close();
      resolve();
    });
  });
}

interface HorizonPaymentRecord {
  id: string;
  type: string;
  to?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  paging_token?: string;
}

async function handlePayment(
  watched: WatchedAccounts,
  record: unknown
): Promise<void> {
  const payment = record as HorizonPaymentRecord;

  // Only notify on received payments.
  const account = payment.to;
  if (!account) return;

  // Fast negative check via bloom filter, then confirm against the DB set.
  if (!watched.filter.mightContain(account)) return;
  if (!watched.set.has(account)) return;

  // Dust filter.
  const amount = parseFloat(payment.amount ?? "0");
  if (amount < config.SPAM_DUST_THRESHOLD) return;

  // Deduplication.
  const isNew = await markSeen(payment.id);
  if (!isNew) {
    console.log(`[payment-notifier] duplicate operation ${payment.id}, skipping`);
    return;
  }

  const devices = await withServiceRole(
    (tx) => getDevicesForAccounts([account], tx),
    { jobName: "paymentNotifier.handlePayment" }
  );
  if (devices.length === 0) return;

  const assetLabel =
    payment.asset_type === "native"
      ? "XLM"
      : (payment.asset_code ?? "asset");

  // Use the first device's locale as a best-effort locale for the message.
  // All devices for an account share the same owner so the first locale is
  // representative; a per-device locale would require sending N messages.
  const locale = devices[0]?.locale ?? "en";

  await sendPushToAll(devices, {
    title: tNotification("payment.received.title", locale),
    body: tNotification("payment.received.body", locale, {
      amount: String(amount),
      asset: assetLabel,
    }),
    data: { operationId: payment.id, account, amount, asset: assetLabel },
  });

  console.log(
    `[payment-notifier] notified ${devices.length} device(s) for account ${account} op ${payment.id}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
