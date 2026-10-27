import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiClient, ApiError, InMemoryTokenStore, SessionExpiredError } from "../src/client.js";

type Call = { url: string; init: RequestInit };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const expired = () =>
  json(401, { error: { code: "TOKEN_EXPIRED", message: "Access token expired", requestId: "r1" } });

test("reads code and message from the error envelope", async () => {
  const client = new ApiClient({
    baseUrl: "http://api.test",
    fetch: async () => json(404, { error: { code: "ACCOUNT_NOT_FOUND", message: "No such account" } }),
  });
  await assert.rejects(client.request("/api/v1/account/G"), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.code, "ACCOUNT_NOT_FOUND");
    assert.equal(err.message, "No such account");
    return true;
  });
});

test("refreshes once for parallel TOKEN_EXPIRED responses and replays", async () => {
  const calls: Call[] = [];
  let refreshed = false;
  const store = new InMemoryTokenStore();
  store.set({ accessToken: "old", refreshToken: "r-old" });

  const client = new ApiClient({
    baseUrl: "http://api.test",
    tokenStore: store,
    fetch: async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/api/v1/auth/refresh")) {
        refreshed = true;
        return json(200, { accessToken: "new", refreshToken: "r-new" });
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === "Bearer new" ? json(200, { ok: true }) : expired();
    },
  });

  const results = await Promise.all([client.request("/a"), client.request("/b"), client.request("/c")]);
  assert.ok(refreshed);
  assert.deepEqual(results, [{ ok: true }, { ok: true }, { ok: true }]);

  const refreshCalls = calls.filter((c) => c.url.endsWith("/api/v1/auth/refresh"));
  assert.equal(refreshCalls.length, 1);
  assert.deepEqual(JSON.parse(String(refreshCalls[0].init.body)), { refreshToken: "r-old" });
  assert.deepEqual(store.get(), { accessToken: "new", refreshToken: "r-new" });
});

test("clears the session when the refresh token is rejected", async () => {
  let expiredCalled = false;
  const store = new InMemoryTokenStore();
  store.set({ accessToken: "old", refreshToken: "revoked" });

  const client = new ApiClient({
    baseUrl: "http://api.test",
    tokenStore: store,
    onSessionExpired: () => {
      expiredCalled = true;
    },
    fetch: async (input) =>
      String(input).endsWith("/refresh")
        ? json(401, { error: { code: "REFRESH_TOKEN_INVALID", message: "revoked" } })
        : expired(),
  });

  await assert.rejects(client.request("/a"), SessionExpiredError);
  assert.ok(expiredCalled);
  assert.equal(store.get(), null);
});

test("retries idempotent requests on 503 and honours Retry-After", async () => {
  let attempts = 0;
  const client = new ApiClient({
    baseUrl: "http://api.test",
    baseDelayMs: 1,
    fetch: async () => {
      attempts += 1;
      return attempts < 3
        ? new Response("", { status: 503, headers: { "Retry-After": "0" } })
        : json(200, { ok: true });
    },
  });
  assert.deepEqual(await client.request("/a"), { ok: true });
  assert.equal(attempts, 3);
});

test("does not retry a POST without an Idempotency-Key", async () => {
  let attempts = 0;
  const client = new ApiClient({
    baseUrl: "http://api.test",
    baseDelayMs: 1,
    fetch: async () => {
      attempts += 1;
      return json(503, { error: { code: "SOROBAN_UNAVAILABLE", message: "down" } });
    },
  });
  await assert.rejects(client.request("/a", { method: "POST", body: {} }), ApiError);
  assert.equal(attempts, 1);
});
