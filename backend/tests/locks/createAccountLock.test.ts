import { createClient } from "redis";
import { config } from "../../src/config";
import { createAccountLock } from "../../src/services/locks/createAccountLock";
import { InProcessAccountLock } from "../../src/services/locks/accountLock";
import { RedisAccountLock } from "../../src/services/locks/redisAccountLock";

jest.mock("redis", () => ({
  createClient: jest.fn(),
}));

describe("createAccountLock", () => {
  const originalLockBackend = config.LOCK_BACKEND;
  const originalRedisUrl = config.REDIS_URL;

  let mockClient: {
    on: jest.Mock;
    connect: jest.Mock;
    quit: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
    };
    (createClient as unknown as jest.Mock).mockReturnValue(mockClient);
  });

  afterAll(() => {
    (config as { LOCK_BACKEND: string | undefined }).LOCK_BACKEND = originalLockBackend;
    (config as { REDIS_URL: string | undefined }).REDIS_URL = originalRedisUrl;
  });

  describe("when LOCK_BACKEND is not 'redis'", () => {
    it("returns InProcessAccountLock with a no-op shutdown when LOCK_BACKEND is in-process", async () => {
      (config as { LOCK_BACKEND: string | undefined }).LOCK_BACKEND = "in-process";

      const handle = await createAccountLock();

      expect(handle.lock).toBeInstanceOf(InProcessAccountLock);
      expect(createClient).not.toHaveBeenCalled();
      await expect(handle.shutdown()).resolves.toBeUndefined();
    });

    it("returns InProcessAccountLock when LOCK_BACKEND is unset or empty", async () => {
      (config as { LOCK_BACKEND: string | undefined }).LOCK_BACKEND = undefined;

      const handle = await createAccountLock();

      expect(handle.lock).toBeInstanceOf(InProcessAccountLock);
      expect(createClient).not.toHaveBeenCalled();
      await expect(handle.shutdown()).resolves.toBeUndefined();
    });
  });

  describe("when LOCK_BACKEND is 'redis'", () => {
    it("returns RedisAccountLock, connects to redis, and calls client.quit() on shutdown", async () => {
      (config as { LOCK_BACKEND: string | undefined }).LOCK_BACKEND = "redis";
      (config as { REDIS_URL: string | undefined }).REDIS_URL = "redis://127.0.0.1:6379";

      const handle = await createAccountLock();

      expect(createClient).toHaveBeenCalledWith({ url: "redis://127.0.0.1:6379" });
      expect(mockClient.on).toHaveBeenCalledWith("error", expect.any(Function));
      expect(mockClient.connect).toHaveBeenCalledTimes(1);
      expect(handle.lock).toBeInstanceOf(RedisAccountLock);

      expect(mockClient.quit).not.toHaveBeenCalled();
      await handle.shutdown();
      expect(mockClient.quit).toHaveBeenCalledTimes(1);
    });

    it("registers an error handler that logs redis client errors", async () => {
      (config as { LOCK_BACKEND: string | undefined }).LOCK_BACKEND = "redis";
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      await createAccountLock();

      const errorCallback = mockClient.on.mock.calls.find((call) => call[0] === "error")?.[1];
      expect(errorCallback).toBeDefined();

      const sampleError = new Error("Redis connection dropped");
      errorCallback(sampleError);

      expect(consoleErrorSpy).toHaveBeenCalledWith("[redis account lock] client error", sampleError);
      consoleErrorSpy.mockRestore();
    });
  });
});