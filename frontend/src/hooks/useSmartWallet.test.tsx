import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import { testQueryClient } from "@/test/render";
import { useContractAssets, useRecoveryState, useSpendAllowances } from "./useSmartWallet";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={testQueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.restoreAllMocks());

describe("smart-wallet hooks", () => {
  it("loads allowances and assets for the account", async () => {
    vi.spyOn(api.contract, "spendAllowances").mockResolvedValue([]);
    vi.spyOn(api.contract, "assets").mockResolvedValue([{ code: "XLM", issuer: null }]);
    const { result } = renderHook(() => ({ allowances: useSpendAllowances(G), assets: useContractAssets(G) }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.assets.data).toHaveLength(1));
    expect(api.contract.spendAllowances).toHaveBeenCalledWith(G, expect.any(AbortSignal));
  });

  it("waits for an account id", () => {
    const spy = vi.spyOn(api.contract, "spendAllowances");
    const { result } = renderHook(() => useSpendAllowances(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(spy).not.toHaveBeenCalled();
  });

  it("reads the recovery state", async () => {
    vi.spyOn(api.contract, "recovery").mockResolvedValue({
      guardians: [],
      guardianCount: 0,
      config: null,
      configured: false,
      proposal: null,
    });
    const { result } = renderHook(() => useRecoveryState(), { wrapper });
    await waitFor(() => expect(result.current.data?.configured).toBe(false));
  });
});
