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

  it("lists claimable balances with paging", async () => {
    const { fetch, account } = setup(jsonResponse({ items: [], nextCursor: null, hasMore: false }));
    await account.claimableBalances(G, { limit: 50 });
    expect(fetch.mock.calls[0]![0]).toBe(`http://api.test/api/v1/account/${G}/claimable-balances?limit=50`);
  });

  it("posts claim and reclaim builds", async () => {
    const id = "0".repeat(72);
    const build = { xdr: "AAAA", networkPassphrase: "Test", balanceId: id, asset: "native", amount: "1", createdTrustline: false };
    const { fetch, account } = setup(jsonResponse(build), jsonResponse(build));
    await expect(account.buildClaim(G, id)).resolves.toEqual(build);
    await account.buildReclaim(G, id);
    expect(fetch.mock.calls[0]![0]).toBe(`http://api.test/api/v1/account/${G}/claimable-balances/${id}/claim/build`);
    expect(fetch.mock.calls[0]![1]?.method).toBe("POST");
    expect(fetch.mock.calls[1]![0]).toBe(`http://api.test/api/v1/account/${G}/claimable-balances/${id}/reclaim/build`);
  });

  it("sends the destination for close dry runs and builds", async () => {
    const D = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
    const { fetch, account } = setup(jsonResponse({ canClose: true }), jsonResponse({ xdr: "AAAA" }));
    await account.closeDryRun(G, D);
    await account.buildClose(G, D);
    expect(fetch.mock.calls[0]![0]).toBe(`http://api.test/api/v1/account/${G}/close/build`);
    expect(fetch.mock.calls[0]![1]?.body).toBe(JSON.stringify({ destination: D, dryRun: true }));
    expect(fetch.mock.calls[1]![1]?.body).toBe(JSON.stringify({ destination: D }));
  });
});
