import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import { testQueryClient } from "@/test/render";
import { isUnfundedAccountError, useAccountBalances, useAccountReserves } from "./useAccount";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={testQueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.restoreAllMocks());

describe("account hooks", () => {
  it("loads balances for an account", async () => {
    vi.spyOn(api.account, "balances").mockResolvedValue({ balances: { XLM: "10.0000000" } });
    const { result } = renderHook(() => useAccountBalances(G), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ XLM: "10.0000000" });
  });

  it("stays idle without an account", () => {
    const spy = vi.spyOn(api.account, "reserves");
    const { result } = renderHook(() => useAccountReserves(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(spy).not.toHaveBeenCalled();
  });

  it("recognises unfunded accounts", async () => {
    vi.spyOn(api.account, "reserves").mockRejectedValue(
      new ApiError("Account not found", { status: 404, code: "ACCOUNT_NOT_FOUND" }),
    );
    const { result } = renderHook(() => useAccountReserves(G), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(isUnfundedAccountError(result.current.error)).toBe(true);
    expect(isUnfundedAccountError(new Error("x"))).toBe(false);
  });
});
