import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import type { TransactionDetail } from "@/lib/api/endpoints/transactions";
import { testQueryClient } from "@/test/render";
import { isTransactionNotFound, useTransaction, useTransactionStatus } from "./useTransaction";

const HASH = "d".repeat(64);
const notFound = () => new ApiError("missing", { status: 404, code: "TRANSACTION_NOT_FOUND" });

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={testQueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.useRealTimers());

describe("useTransaction", () => {
  it("keeps polling while the transaction is not on Horizon yet", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const get = vi
      .spyOn(api.transactions, "get")
      .mockRejectedValueOnce(notFound())
      .mockResolvedValueOnce({ hash: HASH } as TransactionDetail);
    const { result } = renderHook(() => useTransaction(HASH), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    await vi.advanceTimersByTimeAsync(3_000);
    await waitFor(() => expect(result.current.data?.hash).toBe(HASH));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("does not fetch an invalid hash", () => {
    const get = vi.spyOn(api.transactions, "get");
    renderHook(() => useTransaction("nope"), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });

  it("recognises not-found errors", () => {
    expect(isTransactionNotFound(notFound())).toBe(true);
    expect(isTransactionNotFound(new Error("x"))).toBe(false);
  });
});

describe("useTransactionStatus", () => {
  it("polls until the submission settles", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const base = { hash: HASH, accountId: "G", createdAt: "", updatedAt: "" };
    vi.spyOn(api.transactions, "status")
      .mockResolvedValueOnce({ ...base, status: "pending" })
      .mockResolvedValueOnce({ ...base, status: "success" });
    const { result } = renderHook(() => useTransactionStatus(HASH), { wrapper });
    await waitFor(() => expect(result.current.data?.status).toBe("pending"));
    await vi.advanceTimersByTimeAsync(3_000);
    await waitFor(() => expect(result.current.data?.status).toBe("success"));
  });
});
