import { describe, expect, it } from "vitest";
import { errorResponse, jsonResponse, mockFetch } from "@/test/fetch";
import { ApiError } from "../errors";
import { createApiClient } from "../client";
import { isInFlightStatus, isTransactionHash, transactionsApi } from "./transactions";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const HASH = "A".repeat(64);

function setup(...responses: Response[]) {
  const fetch = mockFetch(...responses);
  return { fetch, txs: transactionsApi(createApiClient({ baseUrl: "http://api.test", fetch })) };
}

describe("transactionsApi", () => {
  it("reads a transaction by lower-cased hash from the account's perspective", async () => {
    const detail = { hash: HASH.toLowerCase(), operations: [] };
    const { fetch, txs } = setup(jsonResponse(detail));
    await expect(txs.get(HASH, G)).resolves.toEqual(detail);
    expect(fetch.mock.calls[0]![0]).toBe(`http://api.test/api/v1/transactions/${HASH.toLowerCase()}?account=${G}`);
  });

  it("omits the account query when not given", async () => {
    const { fetch, txs } = setup(jsonResponse({}));
    await txs.get(HASH);
    expect(fetch.mock.calls[0]![0]).toBe(`http://api.test/api/v1/transactions/${HASH.toLowerCase()}`);
  });

  it("reads the submission status", async () => {
    const { fetch, txs } = setup(jsonResponse({ hash: HASH, status: "pending" }));
    await expect(txs.status(HASH)).resolves.toMatchObject({ status: "pending" });
    expect(fetch.mock.calls[0]![0]).toBe(`http://api.test/api/v1/transactions/status/${HASH.toLowerCase()}`);
  });

  it("unwraps the account status feed", async () => {
    const { fetch, txs } = setup(jsonResponse({ transactions: [{ hash: HASH, status: "success" }] }));
    await expect(txs.accountStatuses(G, 5)).resolves.toEqual([{ hash: HASH, status: "success" }]);
    expect(fetch.mock.calls[0]![0]).toBe(`http://api.test/api/v1/transactions/account/${G}/statuses?limit=5`);
  });

  it("maps a missing transaction to an ApiError", async () => {
    const { txs } = setup(errorResponse(404, "TRANSACTION_NOT_FOUND"));
    await expect(txs.get(HASH)).rejects.toSatisfy((err) => err instanceof ApiError && err.code === "TRANSACTION_NOT_FOUND");
  });
});

describe("transaction helpers", () => {
  it("recognises hashes", () => {
    expect(isTransactionHash(HASH)).toBe(true);
    expect(isTransactionHash("abc")).toBe(false);
  });

  it("treats submitting/pending/unknown as in flight", () => {
    expect(isInFlightStatus("pending")).toBe(true);
    expect(isInFlightStatus("success")).toBe(false);
    expect(isInFlightStatus("failed")).toBe(false);
  });
});
