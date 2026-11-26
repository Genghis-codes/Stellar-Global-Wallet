import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { makeQueryClient, shouldRetry } from "./client";
import { queryKeys } from "./keys";

const err = (status: number, code: string) => new ApiError(code, { status, code });

describe("shouldRetry", () => {
  it("retries transient failures up to the limit", () => {
    expect(shouldRetry(0, new ApiError("offline", { status: 0, code: "NETWORK_ERROR", retryable: true }))).toBe(true);
    expect(shouldRetry(1, err(503, "SERVICE_UNAVAILABLE"))).toBe(true);
    expect(shouldRetry(2, err(503, "SERVICE_UNAVAILABLE"))).toBe(false);
  });

  it("does not retry client errors, cancellations or unknown errors", () => {
    expect(shouldRetry(0, err(404, "ACCOUNT_NOT_FOUND"))).toBe(false);
    expect(shouldRetry(0, err(401, "SESSION_EXPIRED"))).toBe(false);
    expect(shouldRetry(0, new ApiError("x", { status: 0, code: "ABORTED", retryable: true }))).toBe(false);
    expect(shouldRetry(0, new Error("boom"))).toBe(false);
  });
});

describe("queryKeys", () => {
  it("nests account keys under the account scope", () => {
    const all = queryKeys.account.all("GA");
    expect(queryKeys.account.balances("GA").slice(0, all.length)).toEqual([...all]);
    expect(queryKeys.account.payments("GA", { limit: 10 })).toEqual(["account", "GA", "payments", { limit: 10 }]);
  });

  it("normalises price key order", () => {
    expect(queryKeys.price.many(["XLM", "AQUA"])).toEqual(queryKeys.price.many(["AQUA", "XLM"]));
  });

  it("builds a client with app defaults", () => {
    const client = makeQueryClient();
    expect(client.getDefaultOptions().queries?.staleTime).toBe(30_000);
  });
});
