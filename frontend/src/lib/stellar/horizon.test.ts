import { describe, expect, it } from "vitest";
import { jsonResponse, mockFetch } from "@/test/fetch";
import { fetchTransactionSignatures } from "./horizon";

describe("fetchTransactionSignatures", () => {
  it("reads the signatures from Horizon", async () => {
    const fetchImpl = mockFetch(jsonResponse({ hash: "x", signatures: ["c2ln", 3] }));
    await expect(fetchTransactionSignatures("ABC", { horizonUrl: "https://h.test", fetchImpl })).resolves.toEqual(["c2ln"]);
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://h.test/transactions/abc");
  });

  it("throws on Horizon errors", async () => {
    const fetchImpl = mockFetch(jsonResponse({}, { status: 404 }));
    await expect(fetchTransactionSignatures("abc", { horizonUrl: "https://h.test", fetchImpl })).rejects.toThrow("404");
  });
});
