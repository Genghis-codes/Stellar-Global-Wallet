import { describe, expect, it, vi } from "vitest";
import { callHeaders, errorResponse, jsonResponse, mockFetch } from "@/test/fetch";
import { createApiClient } from "./client";
import { MemoryTokenStore } from "./tokens";

const BASE = "http://api.test";

function signedIn() {
  const tokens = new MemoryTokenStore();
  tokens.set({ accessToken: "old", refreshToken: "r1", account: "GABC" });
  return tokens;
}

describe("access-token refresh", () => {
  it("refreshes on TOKEN_EXPIRED and retries with the new token", async () => {
    const tokens = signedIn();
    const fetch = mockFetch(
      errorResponse(401, "TOKEN_EXPIRED"),
      jsonResponse({ accessToken: "new", refreshToken: "r2", tokenType: "Bearer" }),
      jsonResponse({ preferences: {} }),
    );
    const client = createApiClient({ baseUrl: BASE, fetch, tokens });
    await expect(client.get("/api/v1/me/preferences")).resolves.toEqual({ preferences: {} });

    expect(fetch.mock.calls[1]![0]).toBe("http://api.test/api/v1/auth/refresh");
    expect(fetch.mock.calls[1]![1]?.body).toBe('{"refreshToken":"r1"}');
    expect(callHeaders(fetch, 2).Authorization).toBe("Bearer new");
    expect(tokens.get()).toEqual({ accessToken: "new", refreshToken: "r2", account: "GABC" });
  });

  it("shares one refresh between concurrent requests", async () => {
    const tokens = signedIn();
    const fetch = mockFetch(
      errorResponse(401, "TOKEN_EXPIRED"),
      errorResponse(401, "TOKEN_EXPIRED"),
      jsonResponse({ accessToken: "new", refreshToken: "r2" }),
      jsonResponse({ n: 1 }),
      jsonResponse({ n: 2 }),
    );
    const client = createApiClient({ baseUrl: BASE, fetch, tokens });
    const results = await Promise.all([client.get("/a"), client.get("/b")]);
    expect(results).toEqual([{ n: 1 }, { n: 2 }]);
    const refreshCalls = fetch.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
  });

  it("expires the session when the refresh token is rejected", async () => {
    const tokens = signedIn();
    const onSessionExpired = vi.fn();
    const fetch = mockFetch(errorResponse(401, "TOKEN_EXPIRED"), errorResponse(401, "REFRESH_TOKEN_INVALID"));
    const client = createApiClient({ baseUrl: BASE, fetch, tokens, onSessionExpired });
    await expect(client.get("/a")).rejects.toMatchObject({ code: "SESSION_EXPIRED", status: 401 });
    expect(tokens.get()).toBeNull();
    expect(onSessionExpired).toHaveBeenCalledOnce();
  });

  it("expires the session immediately on SESSION_REVOKED", async () => {
    const tokens = signedIn();
    const onSessionExpired = vi.fn();
    const fetch = mockFetch(errorResponse(401, "SESSION_REVOKED"));
    const client = createApiClient({ baseUrl: BASE, fetch, tokens, onSessionExpired });
    await expect(client.get("/a")).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(onSessionExpired).toHaveBeenCalledOnce();
  });

  it("passes other 401s through without refreshing", async () => {
    const tokens = signedIn();
    const fetch = mockFetch(errorResponse(401, "ACCOUNT_MISMATCH"));
    const client = createApiClient({ baseUrl: BASE, fetch, tokens });
    await expect(client.get("/a")).rejects.toMatchObject({ code: "ACCOUNT_MISMATCH" });
    expect(tokens.get()).not.toBeNull();
  });

  it("does not refresh anonymous requests", async () => {
    const fetch = mockFetch(errorResponse(401, "TOKEN_MISSING"));
    const client = createApiClient({ baseUrl: BASE, fetch });
    await expect(client.get("/a")).rejects.toMatchObject({ code: "TOKEN_MISSING" });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
