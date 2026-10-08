import { createClient, RedisClientType } from "redis";
import { RedisAccountLock } from "../../src/services/locks/redisAccountLock";
import { LockAcquisitionError } from "../../src/services/stellarErrors";

const REDIS_URL = process.env.REDIS_URL_TEST ?? "redis://localhost:6379";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// These run against a real local Redis (redis-server on localhost:6379) —
// this is the mechanism meant to close the multi-instance gap that
// in-process locking cannot (docs/concurrency.md), so it's exercised for
// real rather than mocked.
describe("RedisAccountLock (real Redis, simulating two API instances)", () => {
  let clientA: RedisClientType;
  let clientB: RedisClientType;

  beforeAll(async () => {
    clientA = createClient({ url: REDIS_URL });
    clientB = createClient({ url: REDIS_URL });
    await clientA.connect();
    await clientB.connect();
  });

  afterAll(async () => {
    await clientA.quit();
    await clientB.quit();
  });

  it("serializes withLock calls for the same account across two independent clients", async () => {
    // Two separate Redis connections standing in for two separate API
    // processes, each with its own RedisAccountLock instance — nothing
    // in-process is shared between them.
    const lockA = new RedisAccountLock(clientA, { retryDelayMs: 10, maxWaitMs: 5000 });
    const lockB = new RedisAccountLock(clientB, { retryDelayMs: 10, maxWaitMs: 5000 });

    const accountId = `test-account-${Date.now()}`;
    const events: string[] = [];

    const taskOnInstance = (lock: RedisAccountLock, name: string, delayMs: number) =>
      lock.withLock(accountId, async () => {
        events.push(`${name}:start`);
        await sleep(delayMs);
        events.push(`${name}:end`);
        return name;
      });

    // Both instances race to acquire the same account lock over separate
    // Redis connections — which one wins is a genuine network race and
    // isn't (and shouldn't be) deterministic. What must hold regardless of
    // winner is mutual exclusion: one holder's start/end pair never
    // interleaves with the other's.
    await Promise.all([
      taskOnInstance(lockA, "instanceA", 60),
      taskOnInstance(lockB, "instanceB", 60),
    ]);

    expect(events).toHaveLength(4);
    const [first, second, third, fourth] = events;
    const winner = first.split(":")[0];
    const loser = winner === "instanceA" ? "instanceB" : "instanceA";
    expect([first, second, third, fourth]).toEqual([
      `${winner}:start`,
      `${winner}:end`,
      `${loser}:start`,
      `${loser}:end`,
    ]);
  }, 10000);

  it("does not serialize different account ids against each other", async () => {
    const lockA = new RedisAccountLock(clientA, { retryDelayMs: 10, maxWaitMs: 5000 });
    const events: string[] = [];

    const start = Date.now();
    await Promise.all([
      lockA.withLock(`acct-x-${Date.now()}`, async () => {
        events.push("x:start");
        await sleep(50);
        events.push("x:end");
      }),
      lockA.withLock(`acct-y-${Date.now()}`, async () => {
        events.push("y:start");
        await sleep(50);
        events.push("y:end");
      }),
    ]);
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(90);
  });

  it("throws a clear LockAcquisitionError when the lock cannot be acquired in time", async () => {
    const accountId = `test-account-timeout-${Date.now()}`;
    const lockA = new RedisAccountLock(clientA, { retryDelayMs: 10, maxWaitMs: 5000 });
    const lockB = new RedisAccountLock(clientB, { retryDelayMs: 10, maxWaitMs: 100 });

    const holderPromise = lockA.withLock(accountId, async () => {
      await sleep(500);
    });

    await sleep(20); // let lockA acquire first
    await expect(lockB.withLock(accountId, async () => "should not run")).rejects.toBeInstanceOf(
      LockAcquisitionError
    );

    await holderPromise;
  }, 10000);
});
