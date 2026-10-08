import { randomUUID } from "crypto";
import type { RedisClientType } from "redis";
import { AccountLock } from "./accountLock";
import { LockAcquisitionError } from "../stellarErrors";

// Standard "check-then-delete" release script: only the holder that set
// the token may clear the key. Without this, a slow caller whose lock
// already expired (TTL) could delete a *different* caller's freshly
// acquired lock on the same account.
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

export interface RedisAccountLockOptions {
  /**
   * How long the lock is held before Redis expires it automatically, in
   * case a process dies mid-submission and never releases. Must comfortably
   * exceed the worst-case time a single sendPayment call can take —
   * bounded in practice by the transaction's setTimeout plus Horizon's
   * submission/poll overhead. Default 45s (setTimeout(30) + margin).
   */
  ttlMs?: number;
  /** Delay between acquisition attempts while the lock is held elsewhere. */
  retryDelayMs?: number;
  /** Give up and reject if the lock can't be acquired within this window. */
  maxWaitMs?: number;
}

/**
 * Cross-process account lock backed by a single Redis instance.
 *
 * This is a SET-NX/PX lock with safe token-checked release, not the full
 * multi-node Redlock algorithm — sufficient for coordinating multiple API
 * instances against one Redis (or one Redis primary with replicas), not
 * for surviving a Redis primary failover mid-lock. See docs/concurrency.md
 * for the tradeoffs and when this is (and isn't) enough.
 */
export class RedisAccountLock implements AccountLock {
  private readonly ttlMs: number;
  private readonly retryDelayMs: number;
  private readonly maxWaitMs: number;

  constructor(
    private readonly client: RedisClientType,
    options: RedisAccountLockOptions = {}
  ) {
    this.ttlMs = options.ttlMs ?? 45_000;
    this.retryDelayMs = options.retryDelayMs ?? 100;
    this.maxWaitMs = options.maxWaitMs ?? 30_000;
  }

  async withLock<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
    const lockKey = `orbit-wal:account-lock:${accountId}`;
    const token = randomUUID();

    const acquired = await this.acquire(lockKey, token);
    if (!acquired) {
      throw new LockAcquisitionError(
        `Timed out after ${this.maxWaitMs}ms waiting for the submission lock ` +
          `on account ${accountId}. Another instance may be mid-submission, ` +
          `or holding a stuck lock. The payment was NOT submitted — safe to retry.`
      );
    }

    try {
      return await fn();
    } finally {
      // Best-effort release; if this fails (e.g. Redis blipped), the TTL
      // still guarantees the lock frees itself within ttlMs.
      await this.client
        .eval(RELEASE_SCRIPT, { keys: [lockKey], arguments: [token] })
        .catch(() => {});
    }
  }

  private async acquire(lockKey: string, token: string): Promise<boolean> {
    const deadline = Date.now() + this.maxWaitMs;
    for (;;) {
      const result = await this.client.set(lockKey, token, {
        NX: true,
        PX: this.ttlMs,
      });
      if (result === "OK") return true;
      if (Date.now() >= deadline) return false;
      await sleep(Math.min(this.retryDelayMs, deadline - Date.now()));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
