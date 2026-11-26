import { afterEach, describe, expect, it, vi } from "vitest";
import { callHeaders, errorResponse, jsonResponse, mockFetch } from "@/test/fetch";
import { buildUrl, createApiClient } from "./client";
import { ApiError, describeError } from "./errors";
import { MemoryTokenStore } from "./tokens";

const BASE = "http://api.test";

afterEach(() => vi.useRealTimers());

describe("buildUrl", () => {
  it("joins base and path and drops empty query values", () => {
    expect(buildUrl(BASE, "/api/v1/price", { assets: "XLM,USDC:G", skip: undefined, none: null })).toBe(
      "http://api.test/api/v1/price?assets=XLM%2CUSDC%3AG",
    );
  });

  it("keeps a base path prefix", () => {
    expect(buildUrl("http://api.test/gw/", "api/v1/flags")).toBe("http://api.test/gw/api/v1/flags");
  });
});

describe("createApiClient", () => {
  it("sends JSON with credentials and parses the response", async () => {
    const fetch = mockFetch(jsonResponse({ ok: true }));
    const client = createApiClient({ baseUrl: BASE, fetch });
    await expect(client.post("/api/v1/x", { a: 1 })).resolves.toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/v1/x");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"a":1}');
    expect(init?.credentials).toBe("include");
    expect(callHeaders(fetch)["Content-Type"]).toBe("application/json");
  });

  it("attaches the bearer token unless auth is disabled", async () => {
    const tokens = new MemoryTokenStore();
    tokens.set({ accessToken: "acc", refreshToken: "ref" });
    const fetch = mockFetch(jsonResponse({}), jsonResponse({}));
    const client = createApiClient({ baseUrl: BASE, fetch, tokens });
    await client.get("/a");
    await client.get("/b", { auth: false });
    expect(callHeaders(fetch, 0).Authorization).toBe("Bearer acc");
    expect(callHeaders(fetch, 1).Authorization).toBeUndefined();
  });

  it("maps the backend error envelope to ApiError", async () => {
    const fetch = mockFetch(
      errorResponse(400, "VALIDATION_ERROR", "Invalid input", { details: [{ path: "q" }], retryable: false }),
    );
    const client = createApiClient({ baseUrl: BASE, fetch });
    const error = await client.get("/a").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid input",
      details: [{ path: "q" }],
      retryable: false,
      requestId: "req-1",
    });
  });

  it("handles non-envelope failures", async () => {
    const fetch = mockFetch(new Response("Bad gateway", { status: 502, headers: { "x-request-id": "hdr" } }));
    const client = createApiClient({ baseUrl: BASE, fetch });
    await expect(client.get("/a")).rejects.toMatchObject({
      status: 502,
      code: "INTERNAL_ERROR",
      retryable: true,
      requestId: "hdr",
    });
  });

  it("maps network failures", async () => {
    const client = createApiClient({ baseUrl: BASE, fetch: mockFetch(new TypeError("Failed to fetch")) });
    const error = await client.get("/a").catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "NETWORK_ERROR", status: 0 });
    expect(describeError(error)).toMatch(/Can't reach/);
  });

  it("times out slow requests", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const client = createApiClient({ baseUrl: BASE, fetch, timeoutMs: 1000 });
    const pending = client.get("/slow").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("reports caller cancellation as ABORTED", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      init?.signal?.aborted ? Promise.reject(new DOMException("aborted", "AbortError")) : Promise.resolve(jsonResponse({})),
    );
    const client = createApiClient({ baseUrl: BASE, fetch });
    await expect(client.get("/a", { signal: controller.signal })).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("returns text bodies on request and undefined for empty bodies", async () => {
    const fetch = mockFetch(new Response("a,b\n1,2", { status: 200 }), new Response(null, { status: 204 }));
    const client = createApiClient({ baseUrl: BASE, fetch });
    await expect(client.get("/csv", { responseType: "text" })).resolves.toBe("a,b\n1,2");
    await expect(client.delete("/x")).resolves.toBeUndefined();
  });
});
