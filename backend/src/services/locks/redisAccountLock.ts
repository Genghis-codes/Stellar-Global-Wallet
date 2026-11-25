import type { RedisClientType } from "redis";
import { AccountLockOptions, BaseAccountLock } from "./accountLock";
import { LockUnavailableError } from "../stellarErrors";
import { metrics } from "../metrics";
import { config } from "../../config";

// Atomically take the lock and bump the per-account fencing counter. The
// counter key never expires, so tokens keep increasing across holders.
const ACQUIRE_SCRIPT = `
if redis.call("SET", KEYS[1], ARGV[1], "NX", "PX", ARGV[2]) then
  return redis.call("INCR", KEYS[2])
end
return false
`;

// Extend only our own lease; a lease that already expired is gone for good.
const EXTEND_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`;

// Standard "check-then-delete" release: only the holder that set the token
// may clear the key, so a slow caller whose lease expired can't delete a
// different caller's freshly acquired lock.
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export type RedisAccountLockOptions = AccountLockOptions;

/**
 * Lease a channel account from the pool. Uses the same SET NX PX + fencing
 * counter semantics as the account lock, but keyed per channel account so
 * several channels can be leased concurrently.
 */
export class RedisChannelLease {
  protected readonly backend = "redis";

  constructor(
    private readonly client: RedisClientType,
    private readonly ttlMs: number
  ) {}

  private keys(channelId: string): [string, string] {
    return [
      `orbit-wal:${config.STELLAR_NETWORK}:channel-lease:${channelId}`,
      `orbit-wal:${config.STELLAR_NETWORK}:channel-lease-fence:${channelId}`,
    ];
  }

  async tryAcquire(channelId: string, token: string): Promise<number | null> {
    if (this.client.isReady === false) this.unavailable(new Error("Redis client is not connected"));
    let result: unknown;
    try {
      result = await this.client.eval(ACQUIRE_SCRIPT, {
        keys: this.keys(channelId),
        arguments: [token, String(this.ttlMs)],
      });
    } catch (err) {
      this.unavailable(err);
    }
    return result === null || result === undefined || result === false ? null : Number(result);
  }

  async tryExtend(channelId: string, token: string): Promise<boolean> {
    const [lockKey] = this.keys(channelId);
    const result = await this.client.eval(EXTEND_SCRIPT, {
      keys: [lockKey],
      arguments: [token, String(this.ttlMs)],
    });
    return Number(result) === 1;
  }

  async tryRelease(channelId: string, token: string): Promise<void> {
    const [lockKey] = this.keys(channelId);
    await this.client.eval(RELEASE_SCRIPT, { keys: [lockKey], arguments: [token] });
  }

  private unavailable(err: unknown): never {
    metrics.lockFailures.inc({ backend: this.backend, reason: "unavailable" });
    throw new LockUnavailableError(
      `The channel lease backend (Redis) is unreachable: ${(err as Error)?.message ?? String(err)}. ` +
        "The payment was NOT submitted — safe to retry."
    );
  }
}

/**
 * Cross-process account lock backed by a single Redis instance: SET NX PX
 * with token-checked release and extension, plus a fencing counter. Not the
 * multi-node Redlock algorithm — see docs/concurrency.md.
 *
 * Fails closed: if Redis can't be reached the acquisition throws
 * `LockUnavailableError` (503) and the callback never runs.
 */
export class RedisAccountLock extends BaseAccountLock {
  protected readonly backend = "redis";

  constructor(
    private readonly client: RedisClientType,
    options: RedisAccountLockOptions = {}
  ) {
    super(options);
  }

  private keys(accountId: string): [string, string] {
    return [
      `orbit-wal:${config.STELLAR_NETWORK}:account-lock:${accountId}`,
      `orbit-wal:${config.STELLAR_NETWORK}:account-lock-fence:${accountId}`,
    ];
  }

  protected async tryAcquire(accountId: string, token: string): Promise<number | null> {
    if (this.client.isReady === false) this.unavailable(new Error("Redis client is not connected"));
    let result: unknown;
    try {
      result = await this.client.eval(ACQUIRE_SCRIPT, {
        keys: this.keys(accountId),
        arguments: [token, String(this.ttlMs)],
      });
    } catch (err) {
      this.unavailable(err);
    }
    return result === null || result === undefined || result === false ? null : Number(result);
  }

  protected async tryExtend(accountId: string, token: string): Promise<boolean> {
    const [lockKey] = this.keys(accountId);
    const result = await this.client.eval(EXTEND_SCRIPT, {
      keys: [lockKey],
      arguments: [token, String(this.ttlMs)],
    });
    return Number(result) === 1;
  }

  protected async tryRelease(accountId: string, token: string): Promise<void> {
    const [lockKey] = this.keys(accountId);
    await this.client.eval(RELEASE_SCRIPT, { keys: [lockKey], arguments: [token] });
  }

  private unavailable(err: unknown): never {
    metrics.lockFailures.inc({ backend: this.backend, reason: "unavailable" });
    throw new LockUnavailableError(
      `The submission lock backend (Redis) is unreachable: ${(err as Error)?.message ?? String(err)}. ` +
        "The payment was NOT submitted — safe to retry."
    );
  }
}
