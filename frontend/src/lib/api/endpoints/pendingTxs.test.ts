import { describe, expect, it } from "vitest";
import { errorResponse, jsonResponse, mockFetch } from "@/test/fetch";
import { createApiClient } from "../client";
import { pendingTxsApi, type PendingTx } from "./pendingTxs";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

const row: PendingTx = {
  id: "tx-1",
  account: G,
  xdr: "AAAA",
  requiredWeight: 2,
  collectedSigners: [G],
  createdBy: G,
  expiresAt: null,
  status: "pending",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  hash: "ab".repeat(32),
  collectedWeight: 1,
};

function setup(...responses: Response[]) {
  const fetch = mockFetch(...responses);
  const client = createApiClient({ baseUrl: "http://api.test", fetch });
  return { fetch, pending: pendingTxsApi(client) };
}

describe("pendingTxsApi", () => {
  it("lists an account's transactions and unwraps items", async () => {
    const { fetch, pending } = setup(jsonResponse({ items: [row] }));
    await expect(pending.list(G)).resolves.toEqual([row]);
    expect(fetch.mock.calls[0]![0]).toBe(`http://api.test/api/v1/pending-txs?account=${G}`);
  });

  it("fetches one by id", async () => {
    const { fetch, pending } = setup(jsonResponse(row));
    await expect(pending.get("tx/1")).resolves.toEqual(row);
    expect(fetch.mock.calls[0]![0]).toBe("http://api.test/api/v1/pending-txs/tx%2F1");
  });

  it("creates with the signed xdr", async () => {
    const { fetch, pending } = setup(jsonResponse(row, { status: 201 }));
    await pending.create("AAAA");
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/v1/pending-txs");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"xdr":"AAAA"}');
  });

  it("adds signatures", async () => {
    const { fetch, pending } = setup(jsonResponse({ ...row, status: "ready", collectedWeight: 2 }));
    await expect(pending.addSignatures("tx-1", "BBBB")).resolves.toMatchObject({ status: "ready" });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/v1/pending-txs/tx-1/signatures");
    expect(init?.body).toBe('{"xdr":"BBBB"}');
  });

  it("cancels with DELETE", async () => {
    const { fetch, pending } = setup(jsonResponse({ ...row, status: "cancelled" }));
    await pending.cancel("tx-1");
    expect(fetch.mock.calls[0]![1]?.method).toBe("DELETE");
  });

  it("surfaces backend error codes", async () => {
    const { pending } = setup(errorResponse(409, "TX_EXPIRED", "Pending transaction is expired"));
    await expect(pending.addSignatures("tx-1", "BBBB")).rejects.toMatchObject({ code: "TX_EXPIRED", status: 409 });
  });
});
