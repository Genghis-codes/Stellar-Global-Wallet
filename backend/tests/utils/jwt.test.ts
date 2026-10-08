import { createClient, RedisClientType } from "redis";
import { RedisRefreshTokenStore, generateAccessToken, verifyAccessToken } from "../../src/utils/jwt";

const REDIS_URL = process.env.REDIS_URL_TEST ?? "redis://localhost:6379";

// These run against a real local Redis (redis-server on localhost:6379) —
// the same real-Redis-over-mocking convention used by
// tests/locks/redisAccountLock.test.ts. Two independent RedisRefreshTokenStore
// instances, each with their own Redis connection, stand in for two
// separate API processes/instances sharing only REDIS_URL — proving state
// genuinely flows through Redis and not through any accidental
// process-level global (issue #74).
describe("RedisRefreshTokenStore (real Redis, simulating two API instances)", () => {
  let clientA: RedisClientType;
  let clientB: RedisClientType;
  let storeA: RedisRefreshTokenStore;
  let storeB: RedisRefreshTokenStore;

  beforeAll(async () => {
    clientA = createClient({ url: REDIS_URL });
    clientB = createClient({ url: REDIS_URL });
    await clientA.connect();
    await clientB.connect();
    storeA = new RedisRefreshTokenStore(clientA);
    storeB = new RedisRefreshTokenStore(clientB);
  });

  afterAll(async () => {
    await clientA.quit();
    await clientB.quit();
  });

  it("a token minted on instance A is readable on instance B", async () => {
    const token = await storeA.generate("user-123");

    expect(await storeB.getSub(token)).toBe("user-123");
  });

  it("a token minted on instance A can be rotated on instance B, invalidating the old token everywhere", async () => {
    const token = await storeA.generate("user-456");

    const rotated = await storeB.rotate(token);
    expect(rotated).not.toBeNull();
    expect(rotated?.sub).toBe("user-456");

    // The old token is gone, regardless of which instance checks.
    expect(await storeA.getSub(token)).toBeNull();
    expect(await storeB.getSub(token)).toBeNull();
  });

  it("rotating an already-rotated token returns null (rotation invalidates the old token)", async () => {
    const token = await storeA.generate("user-789");

    const first = await storeA.rotate(token);
    expect(first).not.toBeNull();

    const second = await storeA.rotate(token);
    expect(second).toBeNull();
  });

  it("revocation on one instance prevents rotation on another", async () => {
    const token = await storeA.generate("user-revoke");

    await storeB.revoke(token);

    expect(await storeA.rotate(token)).toBeNull();
    expect(await storeA.getSub(token)).toBeNull();
  });

  it("a freshly constructed store sharing only REDIS_URL can read a token minted before it existed (simulates a restart)", async () => {
    const token = await storeA.generate("user-restart");

    // A brand-new client + store, standing in for a freshly restarted
    // process that shares nothing with the minting process except Redis.
    const freshClient = createClient({ url: REDIS_URL });
    await freshClient.connect();
    const freshStore = new RedisRefreshTokenStore(freshClient);

    try {
      expect(await freshStore.getSub(token)).toBe("user-restart");
    } finally {
      await freshClient.quit();
    }
  });

  it("returns null for an unknown token", async () => {
    expect(await storeA.getSub("does-not-exist")).toBeNull();
    expect(await storeA.rotate("does-not-exist")).toBeNull();
  });
});

describe("access tokens", () => {
  it("issues a signed access token independent of the refresh store", () => {
    const token = generateAccessToken("user-abc");
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);

    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe("user-abc");
    expect(payload.type).toBe("access");
  });
});
