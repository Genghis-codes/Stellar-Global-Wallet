import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import { testQueryClient } from "@/test/render";
import { toAssetSearchQuery, useAssetSearch, useHiddenAssets, useVerifiedAssetIds } from "./useAssets";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: "GABC" }) }));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={testQueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.restoreAllMocks());

describe("toAssetSearchQuery", () => {
  it("tells codes from domains", () => {
    expect(toAssetSearchQuery(" usdc ")).toEqual({ code: "USDC" });
    expect(toAssetSearchQuery("Circle.com")).toEqual({ domain: "circle.com" });
    expect(toAssetSearchQuery("")).toBeNull();
    expect(toAssetSearchQuery("not valid!")).toBeNull();
  });
});

describe("asset hooks", () => {
  it("indexes verified assets by id", async () => {
    vi.spyOn(api.assets, "verified").mockResolvedValue({
      network: "testnet",
      assets: [{ code: "USDC", issuer: ISSUER, domain: "centre.io", name: "USD Coin" }],
    });
    const { result } = renderHook(() => useVerifiedAssetIds(), { wrapper });
    await waitFor(() => expect(result.current.has(`USDC:${ISSUER}`)).toBe(true));
  });

  it("searches only for valid input", async () => {
    const search = vi.spyOn(api.assets, "search").mockResolvedValue({ results: [], nextCursor: null });
    const { rerender } = renderHook(({ q }) => useAssetSearch(q), { wrapper, initialProps: { q: "" } });
    expect(search).not.toHaveBeenCalled();
    rerender({ q: "usdc" });
    await waitFor(() => expect(search).toHaveBeenCalledWith({ code: "USDC" }, expect.anything()));
  });

  it("toggles hidden assets through preferences", async () => {
    vi.spyOn(api.preferences, "get").mockResolvedValue({ hiddenAssets: ["XLM"] });
    const update = vi.spyOn(api.preferences, "update").mockResolvedValue({ hiddenAssets: ["XLM", "USDC:X"] });
    const { result } = renderHook(() => useHiddenAssets(), { wrapper });
    await waitFor(() => expect(result.current.isHidden("XLM")).toBe(true));
    act(() => result.current.toggle("USDC:X"));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ hiddenAssets: ["XLM", "USDC:X"] }));
    act(() => result.current.toggle("XLM"));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({ hiddenAssets: ["USDC:X"] }));
  });
});
