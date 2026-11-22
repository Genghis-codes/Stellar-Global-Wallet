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

const DEDUP_KEY_PREFIX = `orbit-wal:${config.STELLAR_NETWORK}:notif-dedup:payment:`;
const DEDUP_TTL_SECONDS = 48 * 60 * 60; // 48 h
const CURSOR_KEY = `orbit-wal:${config.STELLAR_NETWORK}:notif-cursor:payments`;
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
  const { rows } = await pool.query<{ account: string }>(
    `SELECT DISTINCT account FROM devices`
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
