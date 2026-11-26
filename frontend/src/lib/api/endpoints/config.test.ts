import { describe, expect, it } from "vitest";
import { jsonResponse, mockFetch } from "@/test/fetch";
import { createApiClient } from "../client";
import { configApi } from "./config";

function setup(...responses: Response[]) {
  const fetch = mockFetch(...responses);
  return { fetch, config: configApi(createApiClient({ baseUrl: "http://api.test", fetch })) };
}

describe("configApi", () => {
  it("unwraps the flags envelope", async () => {
    const flags = { multisig: true, feeBump: true, pathPayments: true, recovery: false, priceOracle: false };
    const { fetch, config } = setup(jsonResponse({ flags }));
    await expect(config.flags()).resolves.toEqual(flags);
    expect(fetch.mock.calls[0]![0]).toBe("http://api.test/api/v1/flags");
  });

  it("reads network info and fees", async () => {
    const { fetch, config } = setup(
      jsonResponse({ network: "testnet", networkPassphrase: "Test SDF Network ; September 2015" }),
      jsonResponse({ low: { stroops: "100", xlm: "0.00001" }, source: "horizon" }),
    );
    await expect(config.networkInfo()).resolves.toMatchObject({ network: "testnet" });
    await expect(config.fees()).resolves.toMatchObject({ source: "horizon" });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "http://api.test/api/v1/network/info",
      "http://api.test/api/v1/network/fees",
    ]);
  });
});
