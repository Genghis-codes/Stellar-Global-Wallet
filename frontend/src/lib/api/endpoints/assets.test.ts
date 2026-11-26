import { describe, expect, it } from "vitest";
import { jsonResponse, mockFetch } from "@/test/fetch";
import { createApiClient } from "../client";
import { assetsApi } from "./assets";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function setup(...responses: Response[]) {
  const fetch = mockFetch(...responses);
  return { fetch, assets: assetsApi(createApiClient({ baseUrl: "http://api.test", fetch })) };
}

describe("assetsApi", () => {
  it("reads the verified list without a session", async () => {
    const body = { network: "testnet", assets: [{ code: "USDC", issuer: ISSUER, domain: "centre.io", name: "USD Coin" }] };
    const { fetch, assets } = setup(jsonResponse(body));
    await expect(assets.verified()).resolves.toEqual(body);
    expect(fetch.mock.calls[0]![0]).toBe("http://api.test/api/v1/assets/verified");
    expect((fetch.mock.calls[0]![1]?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("searches by code with paging", async () => {
    const { fetch, assets } = setup(jsonResponse({ results: [], nextCursor: null }));
    await assets.search({ code: " USDC ", limit: 10, cursor: "abc" });
    expect(fetch.mock.calls[0]![0]).toBe("http://api.test/api/v1/assets/search?code=USDC&limit=10&cursor=abc");
  });

  it("searches by normalised domain", async () => {
    const { fetch, assets } = setup(jsonResponse({ results: [], nextCursor: null }));
    await assets.search({ domain: " Circle.com " });
    expect(fetch.mock.calls[0]![0]).toBe("http://api.test/api/v1/assets/search?domain=circle.com");
  });

  it("reads stellar.toml metadata for one asset", async () => {
    const meta = { code: "USDC", issuer: ISSUER, name: "USD Coin", status: "ok" };
    const { fetch, assets } = setup(jsonResponse(meta));
    await expect(assets.metadata("USDC", ISSUER)).resolves.toEqual(meta);
    expect(fetch.mock.calls[0]![0]).toBe(`http://api.test/api/v1/assets/USDC/${ISSUER}`);
  });
});
