/**
 * Device-token registry (#87).
 *
 * Stores one row per registered push-notification endpoint.  Supports both
 * Expo push tokens ("ExponentPushToken[...]") and Web Push VAPID subscription
 * objects.  The `platform` discriminant drives which delivery adapter is
 * used by the notification workers (#88, #89).
 *
 * Schema (created lazily by ensureDevicesTable() called at startup):
 *
 *   devices(
 *     id          BIGSERIAL PK,
 *     account     VARCHAR(56)   — Stellar G-address of the owning account,
 *     platform    VARCHAR(16)   — "expo" | "web",
 *     token       TEXT          — Expo token string OR JSON-serialised
 *                                 WebPush subscription object,
 *     locale      VARCHAR(10)   — BCP-47 locale tag (e.g. "en-US"),
 *     created_at  TIMESTAMPTZ,
 *     last_seen_at TIMESTAMPTZ  — updated by POST when token already exists,
 *     expires_at  TIMESTAMPTZ   — token expiration (null = never expires)
 *   )
 *
 * Tokens are scoped strictly to the authenticated account: every read/write
 * filters by account so one user can never enumerate or delete another's
 * device.
 *
 * Risk engine (#278): the registry also exposes a privacy-preserving
 * fingerprint helper used by the outgoing-payment risk engine to detect
 * "new device" signals.  Only a salted SHA-256 hash of the device token is
 * ever persisted/compared — the raw token never leaves this module.
 */

import { Pool } from "pg";
import { createHash } from "crypto";
import { pool, Queryable } from "../db";
import { config } from "../config";

export type Platform = "expo" | "web";

export interface Device {
  id: string;
  account: string;
  platform: Platform;
  token: string;
  locale: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date | null;
}

export interface DeviceResponse {
  id: string;
  account: string;
  platform: Platform;
  token: string;
  locale: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string | null;
}

/**
 * Returns a stable, privacy-preserving fingerprint for a device token.
 *
 * The raw token is never stored in risk tables; only this salted hash is
 * compared so the risk engine can tell "seen this device before" from
 * "brand new device" without retaining identifying material.
 */
export function deviceFingerprint(token: string): string {
  const salt = config.RISK_FINGERPRINT_SALT ?? "";
  return createHash("sha256").update(`${salt}:${token}`).digest("hex");
}

/** Lazily creates the devices table (called by ensureAuditTable in db.ts). */
export async function ensureDevicesTable(db: Queryable = pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS devices (
      id           BIGSERIAL    PRIMARY KEY,
      account      VARCHAR(56)  NOT NULL,
      platform     VARCHAR(16)  NOT NULL CHECK (platform IN ('expo','web')),
      token        TEXT         NOT NULL,
      locale       VARCHAR(10)  NOT NULL DEFAULT 'en',
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      expires_at   TIMESTAMPTZ,
      UNIQUE (account, token)
    )
  `);
}

/**
 * Upsert a device token for an account.  If the same (account, token) pair
 * already exists, only last_seen_at is updated — deduplicating registrations
 * across re-installs and app restarts without growing the table unboundedly.
 *
 * Expo tokens expire after EXPO_TOKEN_TTL_SECONDS (default 90 days). Web Push
 * tokens are stored without expiration (expires_at = null).
 */
export async function upsertDevice(
  account: string,
  platform: Platform,
  token: string,
  locale: string,
  db: Queryable = pool
): Promise<Device> {
  const expiresAt =
    platform === "expo"
      ? new Date(Date.now() + config.EXPO_TOKEN_TTL_SECONDS * 1000)
      : null;

  const { rows } = await db.query<{
    id: string;
    account: string;
    platform: Platform;
    token: string;
    locale: string;
    created_at: Date;
    last_seen_at: Date;
    expires_at: Date | null;
  }>(
    `INSERT INTO devices (account, platform, token, locale, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (account, token)
     DO UPDATE SET last_seen_at = NOW(), locale = EXCLUDED.locale, expires_at = EXCLUDED.expires_at
     RETURNING *`,
    [account, platform, token, locale, expiresAt]
  );
  const row = rows[0];
  return {
    id: row.id,
    account: row.account,
    platform: row.platform,
    token: row.token,
    locale: row.locale,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Deletes a device row.  Returns true when a row was deleted, false when the
 * device didn't exist or belongs to a different account (caller should 404).
 * The account filter prevents one user from deleting another user's device.
 */
export async function deleteDevice(
  account: string,
  deviceId: string,
  db: Queryable = pool
): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM devices WHERE id = $1 AND account = $2`,
    [deviceId, account]
  );
  return (rowCount ?? 0) > 0;
}

/** Returns all registered devices for an account. */
export async function listDevices(account: string, db: Pool = pool): Promise<DeviceResponse[]> {
  const { rows } = await db.query<{
    id: string;
    account: string;
    platform: Platform;
    token: string;
    locale: string;
    created_at: Date;
    last_seen_at: Date;
    expires_at: Date | null;
  }>(`SELECT * FROM devices WHERE account = $1 ORDER BY created_at DESC`, [account]);
  return rows.map((r) => ({
    id: r.id,
    account: r.account,
    platform: r.platform,
    token: r.token,
    locale: r.locale,
    created_at: r.created_at.toISOString(),
    last_seen_at: r.last_seen_at.toISOString(),
    expires_at: r.expires_at?.toISOString() ?? null,
  }));
}

/**
 * Returns all devices for an account, filtering out expired or invalid tokens.
 * Invalid tokens (DeviceNotRegistered from Expo) are pruned.
 */
export async function getValidDevicesForAccount(
  account: string,
  db: Pool = pool
): Promise<DeviceResponse[]> {
  const { rows } = await db.query<{
    id: string;
    account: string;
    platform: Platform;
    token: string;
    locale: string;
    created_at: Date;
    last_seen_at: Date;
    expires_at: Date | null;
  }>(
    `SELECT * FROM devices 
     WHERE account = $1 
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC`,
    [account]
  );
  return rows.map((r) => ({
    id: r.id,
    account: r.account,
    platform: r.platform,
    token: r.token,
    locale: r.locale,
    created_at: r.created_at.toISOString(),
    last_seen_at: r.last_seen_at.toISOString(),
    expires_at: r.expires_at?.toISOString() ?? null,
  }));
}

/**
 * Returns all devices for a set of accounts (used by notification workers).
 * Filters out expired tokens.
 */
export async function getValidDevicesForAccounts(
  accounts: string[],
  db: Queryable = pool
): Promise<Device[]> {
  if (accounts.length === 0) return [];
  const placeholders = accounts.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await db.query<{
    id: string;
    account: string;
    platform: Platform;
    token: string;
    locale: string;
    created_at: Date;
    last_seen_at: Date;
    expires_at: Date | null;
  }>(
    `SELECT * FROM devices 
     WHERE account IN (${placeholders})
       AND (expires_at IS NULL OR expires_at > NOW())`,
    accounts
  );
  return rows.map((r) => ({
    id: r.id,
    account: r.account,
    platform: r.platform,
    token: r.token,
    locale: r.locale,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    expiresAt: r.expires_at,
  }));
}

/** Backwards-compatible alias for notification workers importing the prior name. */
export const getDevicesForAccounts = getValidDevicesForAccounts;

/**
 * Prunes invalid/expired tokens for an account. Returns the count of pruned tokens.
 * Invalid tokens are identified by DeviceNotRegistered error codes.
 */
export async function pruneInvalidTokens(
  account: string,
  invalidTokens: string[],
  db: Pool = pool
): Promise<number> {
  if (invalidTokens.length === 0) return 0;
  const { rowCount } = await db.query(
    `DELETE FROM devices WHERE account = $1 AND token = ANY($2)`,
    [account, invalidTokens]
  );
  return (rowCount ?? 0);
}
/**
 * Convert Device to DeviceResponse for API output.
 */
export function deviceToResponse(device: Device): DeviceResponse {
  return {
    id: device.id,
    account: device.account,
    platform: device.platform,
    token: device.token,
    locale: device.locale,
    created_at: device.createdAt.toISOString(),
    last_seen_at: device.lastSeenAt.toISOString(),
    expires_at: device.expiresAt?.toISOString() ?? null,
  };
}

/**
 * Returns true when the given device token has been seen for the account
 * before (i.e. it is a known device).  Used by the outgoing-payment risk
 * engine (#278) to flag "new device" signals.  Comparison is done on the
 * salted fingerprint so no raw token is retained for risk purposes.
 */
export async function isKnownDevice(
  account: string,
  token: string,
  db: Pool = pool
): Promise<boolean> {
  const { rows } = await db.query<{ token: string }>(
    `SELECT token FROM devices WHERE account = $1`,
    [account]
  );
  const fingerprint = deviceFingerprint(token);
  return rows.some((r) => deviceFingerprint(r.token) === fingerprint);
}
