import { describe, expect, it } from "vitest";
import { jsonResponse, mockFetch } from "@/test/fetch";
import { createApiClient } from "../client";
import { accountApi } from "./account";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

function setup(...responses: Response[]) {
  const fetch = mockFetch(...responses);
  return { fetch, account: accountApi(createApiClient({ baseUrl: "http://api.test", fetch })) };
}

describe("accountApi", () => {
  it("reads balances", async () => {
    const { fetch, account } = setup(jsonResponse({ balances: { XLM: "100.0000000", USDC: "5.0000000" } }));
    await expect(account.balances(G)).resolves.toEqual({ balances: { XLM: "100.0000000", USDC: "5.0000000" } });
    expect(fetch.mock.calls[0]![0]).toBe(`http://api.test/api/v1/account/${G}/balances`);
  });

  it("passes pagination to list endpoints", async () => {
    const { fetch, account } = setup(jsonResponse({ items: [], nextCursor: null, hasMore: false }));
    await account.payments(G, { cursor: "123", limit: 10 });
    expect(fetch.mock.calls[0]![0]).toBe(`http://api.test/api/v1/account/${G}/payments?cursor=123&limit=10`);
  });

  it("returns the CSV export as text", async () => {
    const { fetch, account } = setup(new Response("date,hash\n", { status: 200 }));
    await expect(account.exportCsv(G, { from: "2026-01-01T00:00:00Z" })).resolves.toBe("date,hash\n");
    expect(String(fetch.mock.calls[0]![0])).toContain("/transactions/export.csv?from=2026-01-01T00%3A00%3A00Z");
  });

  it("sends the muxed id as a string", async () => {
    const { fetch, account } = setup(jsonResponse({ address: "M...", baseAccount: G, id: "7" }));
    await account.muxed(G, 7);
    expect(fetch.mock.calls[0]![1]?.body).toBe('{"id":"7"}');
  });
});
