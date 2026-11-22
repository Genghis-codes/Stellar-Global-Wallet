/**
 * Recovery & guardian event notification worker (#89).
 *
 * Security-critical: the owner MUST be alerted the moment a recovery is
 * initiated, regardless of any notification preferences.  This closes the
 * attack window described below.
 *
 * Threat model
 * ────────────
 * Attacker: a compromised or malicious guardian (or someone who has obtained
 *           guardian keys out-of-band).
 * What they can do today (without this fix): silently call `initiate_recovery`
 *   on the contract and collect guardian approvals without the owner knowing
 *   until funds have moved.
 * What this fix does: as soon as the indexer observes a `recovery.initiated`
 *   or guardian-approval event, it pushes an alert to every device registered
 *   for the owner account.  Owner alerts bypass the quiet-hours/preferences
 *   check intentionally — the issue explicitly states "Cannot be disabled".
 *
 * Events watched (via Soroban RPC getEvents, poll loop):
 *   topic[0] = "recovery", topic[1] = "initiated"  → owner alert + guardian alert
 *   topic[0] = "recovery", topic[1] = "approved"   → owner alert
 *   topic[0] = "guardian", topic[1] = "added"      → owner alert
 *   topic[0] = "guardian", topic[1] = "removed"    → owner alert
 *   topic[0] = "migration", topic[1] = "asset_untracked" → owner notice (#178,
 *     handled by assetMigrationNotifier)
 *
 * SEP-30 recovery servers (#260)
 * ──────────────────────────────
 * Recovery can additionally be delegated to a SEP-30 recovery server as an
 * alternative to guardians.  When `SEP30_RECOVERY_SERVER_URL` is configured,
 * the notifier also watches the SEP-30 server for recovery signer activity
 * and alerts the owner.  SEP-30 servers require identity verification before
 * a signer can be registered; the notifier surfaces the verification state so
 * the owner is aware of pending identity checks.  SEP-30 is combined with
 * guardians — it does not replace them.
 *
 * Deduplication: event IDs from Soroban RPC are stored in Redis (SET NX,
 * 48-hour TTL) so retries never re-deliver.
 *
 * Cache invalidation: after processing state-mutating events (guardian changes,
 * recovery changes), bust the contract cache so subsequent reads reflect the
 * new on-chain state immediately.
 */

import { createClient } from "redis";
import { config } from "../config";
import { withServiceRole } from "../db";
import { getDevicesForAccounts } from "./deviceRegistry";
import { sendPushToAll } from "./pushSender";
import { tNotification } from "./i18nHelper";
import { isAssetUntrackedTopic, notifyAssetUntracked } from "./assetMigrationNotifier";
import { bustContractCache } from "./sorobanCache";

const DEDUP_KEY_PREFIX = `orbit-wal:${config.STELLAR_NETWORK}:notif-dedup:recovery:`;
const DEDUP_TTL_SECONDS = 48 * 60 * 60;
const POLL_INTERVAL_MS = 10_000; // poll every 10 s
const RECONNECT_DELAY_MS = 15_000;

let dedupClient: ReturnType<typeof createClient> | undefined;

function getDedupClient() {
  if (!dedupClient) {
    dedupClient = createClient({ url: config.REDIS_URL });
    dedupClient.on("error", (err: Error) =>
      console.error("[recovery-notifier] redis error", err.message)
    );
  }
  return dedupClient;
}

async function ensureDedupConnected() {
  const c = getDedupClient();
  if (!c.isOpen) await c.connect();
  return c;
}

async function markSeen(eventId: string): Promise<boolean> {
  const client = await ensureDedupConnected();
  const key = `${DEDUP_KEY_PREFIX}${eventId}`;
  const result = await client.set(key, "1", { NX: true, EX: DEDUP_TTL_SECONDS });
  return result === "OK";
}

// ---------------------------------------------------------------------------
// SEP-30 recovery server integration (#260)
// ---------------------------------------------------------------------------

/**
 * SEP-30 recovery signer as returned by the recovery server's
 * `GET /accounts/{account}/signers` endpoint.
 */
export interface Sep30RecoverySigner {
  key: string;
  type: "ed25519" | "hash-x" | "phone" | "email";
  weight: number;
  /** Identity verification state required by the SEP-30 server. */
  identityVerified?: boolean;
}

/**
 * Fetches the SEP-30 recovery signers registered for an account.  Returns an
 * empty list when no SEP-30 server is configured so guardian-only recovery
 * continues to work unchanged.
 */
export async function fetchSep30Signers(
  account: string
): Promise<Sep30RecoverySigner[]> {
  if (!config.SEP30_RECOVERY_SERVER_URL) return [];

  const url = new URL(
    `/accounts/${encodeURIComponent(account)}/signers`,
    config.SEP30_RECOVERY_SERVER_URL
  );

  const { default: https } = await import("https");
  const raw: string = await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: "GET",
        headers: { Accept: "application/json" },
      },
      (res) => {
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", () => resolve(Buffer.concat(chunks).toString()));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.end();
  });

  const parsed = JSON.parse(raw) as {
    signers?: Sep30RecoverySigner[];
    error?: string;
  };
  if (parsed.error) {
    throw new Error(`SEP-30 error: ${parsed.error}`);
  }
  return parsed.signers ?? [];
}

/**
 * Alerts the owner when SEP-30 recovery signers are registered or when an
 * identity verification is pending.  Combined with guardian recovery — this
 * does not replace guardian alerts.
 */
async function notifySep30Signers(
  ownerAddress: string,
  signers: Sep30RecoverySigner[],
  eventId: string
): Promise<void> {
  if (signers.length === 0) return;

  const ownerDevices = await getDevicesForAccounts([ownerAddress]);
  if (ownerDevices.length === 0) return;

  const locale = ownerDevices[0]?.locale ?? "en";
  const pendingIdentity = signers.some((s) => s.identityVerified === false);
  const titleKey = pendingIdentity
    ? ("recovery.sep30.identity_pending.title" as const)
    : ("recovery.sep30.signers.title" as const);
  const bodyKey = pendingIdentity
    ? ("recovery.sep30.identity_pending.body" as const)
    : ("recovery.sep30.signers.body" as const);

  await sendPushToAll(ownerDevices, {
    title: tNotification(titleKey, locale),
    body: tNotification(bodyKey, locale),
    data: {
      eventId,
      topic0: "recovery",
      topic1: pendingIdentity ? "sep30_identity_pending" : "sep30_signers",
    },
  });
  console.log(
    `[recovery-notifier] SEP-30 alert sent to ${ownerDevices.length} device(s) for ${ownerAddress}`
  );
}

// ---------------------------------------------------------------------------
// Soroban event types (subset we care about)
// ---------------------------------------------------------------------------

interface SorobanEventValue {
  type: string;
  value: unknown;
}

interface SorobanEvent {
  id: string;
  contractId: string;
  topic: SorobanEventValue[];
  value: SorobanEventValue;
  ledger: number;
}

interface SorobanGetEventsResponse {
  events: SorobanEvent[];
  latestLedger: number;
}

/**
 * Starts the recovery-event notification worker.  Never returns — runs for
 * the lifetime of the process.  Call once from index.ts after startup.
 */
export async function startRecoveryNotifier(): Promise<void> {
  if (!config.GLOBE_WALLET_CONTRACT_ID) {
    console.warn(
      "[recovery-notifier] GLOBE_WALLET_CONTRACT_ID not set, worker disabled"
    );
    return;
  }

  console.log("[recovery-notifier] starting for contract", config.GLOBE_WALLET_CONTRACT_ID);
  if (config.SEP30_RECOVERY_SERVER_URL) {
    console.log(
      "[recovery-notifier] SEP-30 recovery server enabled:",
      config.SEP30_RECOVERY_SERVER_URL
    );
  }

  let startLedger = 0; // 0 = latest; will be updated after each poll

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const result = await pollEvents(startLedger);
      if (result !== null) {
        startLedger = result.latestLedger;
        for (const event of result.events) {
          await processEvent(event);
        }
      }
    } catch (err) {
      console.error(
        "[recovery-notifier] poll error, retrying in",
        RECONNECT_DELAY_MS,
        "ms",
        (err as Error).message
      );
      await sleep(RECONNECT_DELAY_MS);
      continue;
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function pollEvents(
  startLedger: number
): Promise<SorobanGetEventsResponse | null> {
  if (!config.GLOBE_WALLET_CONTRACT_ID) return null;

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "getEvents",
    params: {
      startLedger: startLedger || undefined,
      filters: [
        {
          type: "contract",
          contractIds: [config.GLOBE_WALLET_CONTRACT_ID],
          topics: [
            // recovery.initiated, recovery.approved
            ["recovery", "*"],
            // guardian.added, guardian.removed
            ["guardian", "*"],
            // migration.asset_untracked (#178)
            ["migration", "*"],
          ],
        },
      ],
      pagination: { limit: 100 },
    },
  });

  const { default: https } = await import("https");
  const rpcUrl = new URL(config.SOROBAN_RPC_URL);

  const raw: string = await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const req = https.request(
      {
        hostname: rpcUrl.hostname,
        port: rpcUrl.port || 443,
        path: rpcUrl.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", () => resolve(Buffer.concat(chunks).toString()));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });

  const parsed = JSON.parse(raw) as {
    result?: { events: SorobanEvent[]; latestLedger: number };
    error?: { message: string };
  };

  if (parsed.error) {
    throw new Error(`Soroban RPC error: ${parsed.error.message}`);
  }

  return parsed.result ?? null;
}

async function processEvent(event: SorobanEvent): Promise<void> {
  const isNew = await markSeen(event.id);
  if (!isNew) return;

  const topic0 = extractTopicString(event.topic[0]);
  const topic1 = extractTopicString(event.topic[1]);

  if (!topic0 || !topic1) return;

  if (isAssetUntrackedTopic(topic0, topic1)) {
    await notifyAssetUntracked(event.value, { eventId: event.id, contractId: event.contractId });
    return;
  }

  // Extract the owner address from the event value (contract emits the
  // owner/user address as the event body).
  const ownerAddress = extractAddress(event.value);
  if (!ownerAddress) return;

  const isRecoveryInitiated = topic0 === "recovery" && topic1 === "initiated";
  const isRecoveryApproved = topic0 === "recovery" && topic1 === "approved";
  const isGuardianEvent =
    topic0 === "guardian" && (topic1 === "added" || topic1 === "removed");

  if (!isRecoveryInitiated && !isRecoveryApproved && !isGuardianEvent) return;

  // Owner notification — ALWAYS sent, cannot be disabled (#89 requirement).
  const ownerDevices = await withServiceRole(
    (tx) => getDevicesForAccounts([ownerAddress], tx),
    { jobName: "recoveryNotifier.ownerAlert" }
  );
  if (ownerDevices.length > 0) {
    const locale = ownerDevices[0]?.locale ?? "en";
    const titleKey = `${topic0}.${topic1}.title` as const;
    const bodyKey = `${topic0}.${topic1}.body` as const;
    await sendPushToAll(ownerDevices, {
      title: tNotification(titleKey, locale),
      body: tNotification(bodyKey, locale),
      data: { eventId: event.id, contractId: event.contractId, topic0, topic1 },
    });
    console.log(
      `[recovery-notifier] owner alert (${topic0}.${topic1}) sent to ${ownerDevices.length} device(s) for ${ownerAddress}`
    );
  }

  // SEP-30 recovery server integration (#260): when a recovery is initiated,
  // also surface any SEP-30 recovery signers so the owner is aware of the
  // alternative recovery path alongside guardians.
  if (isRecoveryInitiated && config.SEP30_RECOVERY_SERVER_URL) {
    try {
      const signers = await fetchSep30Signers(ownerAddress);
      await notifySep30Signers(ownerAddress, signers, event.id);
    } catch (err) {
      console.error(
        "[recovery-notifier] SEP-30 signer lookup failed",
        (err as Error).message
      );
    }
  }

  // Exclude the owner from the guardian list (should not happen but be safe).
  const otherGuardians = guardianAddresses.filter((g) => g !== ownerAddress);
  if (otherGuardians.length === 0) return;

  const devices = await withServiceRole(
    (tx) => getDevicesForAccounts(otherGuardians, tx),
    { jobName: "recoveryNotifier.guardianAlert" }
  );
  if (devices.length === 0) return;

  const locale = devices[0]?.locale ?? "en";
  await sendPushToAll(devices, {
    title: tNotification("guardian.approval_needed.title", locale),
    body: tNotification("guardian.approval_needed.body", locale),
    data: { eventId: event.id, contractId: event.contractId, ownerAddress },
  });
  console.log(
    `[recovery-notifier] guardian approval request sent to ${devices.length} device(s)`
  );
}

function extractTopicString(topic: SorobanEventValue | undefined): string | null {
  if (!topic) return null;
  if (typeof topic.value === "string") return topic.value;
  return null;
}

function extractAddress(value: SorobanEventValue): string | null {
  if (typeof value.value === "string") return value.value;
  if (value.value && typeof value.value === "object") {
    const obj = value.value as Record<string, unknown>;
    if (typeof obj.address === "string") return obj.address;
    if (typeof obj.owner === "string") return obj.owner;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
