import { describe, expect, it } from "vitest";
import { callHeaders, jsonResponse, mockFetch } from "@/test/fetch";
import { createApiClient } from "../client";
import { MemoryTokenStore } from "../tokens";
import { preferencesApi } from "./preferences";
import { priceApi } from "./price";

describe("priceApi", () => {
  it("batches assets into one request and unwraps prices", async () => {
    const fetch = mockFetch(jsonResponse({ currency: "USD", prices: [{ asset: "XLM", price: "0.1" }] }));
    const price = priceApi(createApiClient({ baseUrl: "http://api.test", fetch }));
    await expect(price.many(["XLM", "USDC:GA5Z"])).resolves.toEqual([{ asset: "XLM", price: "0.1" }]);
    expect(fetch.mock.calls[0]![0]).toBe("http://api.test/api/v1/price?assets=XLM%2CUSDC%3AGA5Z");
  });

  it("skips the request for an empty list", async () => {
    const fetch = mockFetch();
    await expect(priceApi(createApiClient({ baseUrl: "http://api.test", fetch })).many([])).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("encodes the asset in history paths", async () => {
    const fetch = mockFetch(jsonResponse({ points: [] }));
    await priceApi(createApiClient({ baseUrl: "http://api.test", fetch })).history("USDC:GA5Z", "24h");
    expect(fetch.mock.calls[0]![0]).toBe("http://api.test/api/v1/price/USDC%3AGA5Z/history?range=24h");
  });
});

describe("preferencesApi", () => {
  it("reads and merges preferences with the session token", async () => {
    const tokens = new MemoryTokenStore();
    tokens.set({ accessToken: "acc", refreshToken: "ref" });
    const fetch = mockFetch(jsonResponse({ preferences: {} }), jsonResponse({ preferences: { currency: "EUR" } }));
    const prefs = preferencesApi(createApiClient({ baseUrl: "http://api.test", fetch, tokens }));
    await expect(prefs.get()).resolves.toEqual({});
    await expect(prefs.update({ currency: "EUR" })).resolves.toEqual({ currency: "EUR" });
    expect(callHeaders(fetch, 1).Authorization).toBe("Bearer acc");
    expect(fetch.mock.calls[1]![1]?.method).toBe("PUT");
  });
});
