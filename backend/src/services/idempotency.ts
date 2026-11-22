import { createHash } from "crypto";
import { pool, Queryable } from "../db";
import { AppError } from "../errors/appError";

/** Cached results are replayed for 24 hours; after that the key is free to reuse. */
const TTL_SQL = "INTERVAL '24 hours'";

export interface IdempotencyResult {
  hash: string;
  successful: boolean;
}

/**
 * Compute a SHA-256 fingerprint of the request body so a key can only be
 * replayed for the exact same request payload. Sorted keys make the hash
 * insensitive to property ordering in the JSON body (#198).
 */
export function requestFingerprint(body: unknown): string {
  const stable = JSON.stringify(body, Object.keys(body as object).sort());
  return createHash("sha256").update(stable).digest("hex");
}

/**
 * Atomically claim an idempotency key bound to a request fingerprint.
 *
 * Returns:
 *  - `{ status: "hit", result }` — a completed result already exists for
 *    this (key, fingerprint) pair; the caller should replay it.
 *  - `{ status: "claimed" }` — this process now owns the key; the caller
 *    should execute the operation and call `commitResult` when done.
 *  - `{ status: "conflict" }` — the key exists but with a *different*
 *    fingerprint, meaning the same idempotency key is being reused for a
 *    different request body. The caller should return 422.
 *  - `{ status: "in-flight" }` — another process claimed the key but has
 *    not committed a result yet. The caller should return 409 / retry.
 *
 * Uses INSERT … ON CONFLICT DO NOTHING so the first writer wins
 * atomically; no separate read-then-write gap (#198).
 */
/**
 * Translates low-level Postgres connection/transport errors into a clean
 * retryable `503 SERVICE_UNAVAILABLE` AppError so internal hosts/ports are
 * never leaked in API error envelopes (#234).
 */
export function translateIdempotencyStoreError(err: unknown): unknown {
  if (err instanceof AppError) return err;
  const candidate = err as { code?: unknown; message?: unknown; cause?: { code?: unknown } };
  const code = typeof candidate?.code === "string" ? candidate.code : candidate?.cause?.code;
  const pgTransportCodes = new Set([
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "EPIPE",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ENOTFOUND",
    "57P01",
    "57P02",
    "57P03",
    "08000",
    "08003",
    "08006",
  ]);
  const msg = typeof candidate?.message === "string" ? candidate.message : "";
  if (
    (typeof code === "string" && pgTransportCodes.has(code)) ||
    /(connection terminated|timeout exceeded when trying to connect|econnrefused|econnreset|socket hang up)/i.test(
      msg
    )
  ) {
    return new AppError("Idempotency store is temporarily unavailable. Please retry shortly.", {
      code: "SERVICE_UNAVAILABLE",
      status: 503,
      retryable: true,
    });
  }
  return err;
}

export async function claimIdempotencyKey(
  sourcePublicKey: string,
  idempotencyKey: string,
  fingerprint: string,
  db: Queryable = pool
): Promise<
  | { status: "hit"; result: IdempotencyResult }
  | { status: "claimed" }
  | { status: "conflict" }
  | { status: "in-flight" }
> {
  try {
    // Try to atomically insert a "pending" sentinel row.
    const insert = await pool.query(
      `INSERT INTO idempotency_keys
         (source_public_key, idempotency_key, request_fingerprint, result_hash, result_successful, committed)
       VALUES ($1, $2, $3, '', false, false)
       ON CONFLICT (source_public_key, idempotency_key) DO NOTHING
       RETURNING id`,
      [sourcePublicKey, idempotencyKey, fingerprint]
    );

    if (insert.rows.length > 0) {
      // We inserted the sentinel — this process owns the key.
      return { status: "claimed" };
    }

    // A row already exists. Inspect it.
    const existing = await pool.query(
      `SELECT request_fingerprint, result_hash, result_successful, committed, created_at
       FROM idempotency_keys
       WHERE source_public_key = $1 AND idempotency_key = $2`,
      [sourcePublicKey, idempotencyKey]
    );

    if (existing.rows.length === 0) {
      // Expired and cleaned up between our INSERT and this SELECT — treat as a
      // fresh claim. The next INSERT attempt will win.
      return { status: "claimed" };
    }

    const row = existing.rows[0] as {
      request_fingerprint: string;
      result_hash: string;
      result_successful: boolean;
      committed: boolean;
      created_at: Date;
    };

    // Expired rows are stale; delete and let the caller re-claim.
    const ageMs = Date.now() - row.created_at.getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      await pool.query(
        `DELETE FROM idempotency_keys
         WHERE source_public_key = $1 AND idempotency_key = $2 AND created_at = $3`,
        [sourcePublicKey, idempotencyKey, row.created_at]
      );
      return { status: "claimed" };
    }

    if (row.request_fingerprint !== fingerprint) {
      return { status: "conflict" };
    }

    if (!row.committed) {
      return { status: "in-flight" };
    }

    return {
      status: "hit",
      result: { hash: row.result_hash, successful: row.result_successful },
    };
  } catch (err) {
    throw translateIdempotencyStoreError(err);
  }
}

/**
 * Commit the result of a successfully executed operation to the idempotency
 * row that was previously claimed via `claimIdempotencyKey`. Marks the row
 * as committed so subsequent calls with the same key return the cached
 * result instead of re-executing.
 */
export async function commitIdempotencyResult(
  sourcePublicKey: string,
  idempotencyKey: string,
  fingerprint: string,
  hash: string,
  successful: boolean,
  db: Queryable = pool
): Promise<void> {
  try {
    await pool.query(
      `UPDATE idempotency_keys
       SET result_hash = $4, result_successful = $5, committed = true
       WHERE source_public_key = $1 AND idempotency_key = $2 AND request_fingerprint = $3`,
      [sourcePublicKey, idempotencyKey, fingerprint, hash, successful]
    );
  } catch (err) {
    throw translateIdempotencyStoreError(err);
  }
}

/**
 * Release an idempotency key if the operation failed before producing a
 * result, so the client can retry with the same key.
 */
export async function releaseIdempotencyKey(
  sourcePublicKey: string,
  idempotencyKey: string,
  db: Queryable = pool
): Promise<void> {
  await db.query(
    `DELETE FROM idempotency_keys
     WHERE source_public_key = $1 AND idempotency_key = $2 AND committed = false`,
    [sourcePublicKey, idempotencyKey]
  );
}

// ---------------------------------------------------------------------------
// Backwards-compatible shims used by callers that have not yet migrated to
// the atomic claim/commit API above (#198 migration path).
// ---------------------------------------------------------------------------

/** @deprecated Use claimIdempotencyKey + commitIdempotencyResult instead. */
export async function getCachedResult(
  sourcePublicKey: string,
  idempotencyKey: string,
  db: Queryable = pool
): Promise<IdempotencyResult | null> {
  const result = await db.query(
    `SELECT result_hash, result_successful FROM idempotency_keys
     WHERE source_public_key = $1 AND idempotency_key = $2
       AND committed = true AND created_at > NOW() - ${TTL_SQL}`,
    [sourcePublicKey, idempotencyKey]
  );
  if (result.rows.length > 0) {
    return {
      hash: result.rows[0].result_hash,
      successful: result.rows[0].result_successful,
    };
  }
  return null;
}

/** @deprecated Use claimIdempotencyKey + commitIdempotencyResult instead. */
export async function cacheResult(
  sourcePublicKey: string,
  idempotencyKey: string,
  hash: string,
  successful: boolean,
  db: Queryable = pool
): Promise<void> {
  await db.query(
    `INSERT INTO idempotency_keys
       (source_public_key, idempotency_key, request_fingerprint, result_hash, result_successful, committed)
     VALUES ($1, $2, '', $3, $4, true)
     ON CONFLICT (source_public_key, idempotency_key) DO UPDATE
       SET result_hash = EXCLUDED.result_hash,
           result_successful = EXCLUDED.result_successful,
           committed = true,
           created_at = NOW()
       WHERE idempotency_keys.created_at <= NOW() - ${TTL_SQL}`,
    [sourcePublicKey, idempotencyKey, hash, successful]
  );
}

// Re-export for callers that want explicit error handling.
export { AppError };
