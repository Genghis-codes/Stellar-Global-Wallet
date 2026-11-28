import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import type { PaymentPath } from "@/lib/api/endpoints/wallet";
import { testQueryClient } from "@/test/render";
import { canQuote, useSwapQuote } from "./useSwapQuote";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const USDC = "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G }) }));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={testQueryClient()}>{children}</QueryClientProvider>;
}

const quote = (source: string, destination: string): PaymentPath => ({
  source_asset_type: "native",
  source_amount: source,
  destination_asset_type: "credit_alphanum4",
  destination_asset_code: "USDC",
  destination_asset_issuer: USDC.split(":")[1],
  destination_amount: destination,
  path: [],
});

afterEach(() => vi.restoreAllMocks());

describe("canQuote", () => {
  it("needs two different assets and a positive amount", () => {
    expect(canQuote({ mode: "send", amount: "10", from: "XLM", to: USDC })).toBe(true);
    expect(canQuote({ mode: "send", amount: "10", from: "XLM", to: "XLM" })).toBe(false);
    expect(canQuote({ mode: "send", amount: "0", from: "XLM", to: USDC })).toBe(false);
    expect(canQuote({ mode: "send", amount: "1.12345678", from: "XLM", to: USDC })).toBe(false);
  });
});

describe("useSwapQuote", () => {
  it("asks strict-send for exact-input swaps and keeps the best route", async () => {
    const spy = vi.spyOn(api.wallet, "strictSendPaths").mockResolvedValue([quote("10", "1.1"), quote("10", "1.2")]);
    const { result } = renderHook(() => useSwapQuote({ mode: "send", amount: "10", from: "XLM", to: USDC }, 0), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data?.destination_amount).toBe("1.2"));
    expect(spy).toHaveBeenCalledWith(G, { sourceAmount: "10", sourceAsset: "XLM", destinationAsset: USDC }, expect.anything());
  });

  it("asks strict-receive for exact-output swaps", async () => {
    const spy = vi.spyOn(api.wallet, "strictReceivePaths").mockResolvedValue([quote("9", "1"), quote("8.5", "1")]);
    const { result } = renderHook(() => useSwapQuote({ mode: "receive", amount: "1", from: "XLM", to: USDC }, 0), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data?.source_amount).toBe("8.5"));
    expect(spy).toHaveBeenCalledWith(G, { destinationAmount: "1", destinationAsset: USDC, sourceAsset: "XLM" }, expect.anything());
  });

  it("returns null when there is no route and skips invalid input", async () => {
    const send = vi.spyOn(api.wallet, "strictSendPaths").mockResolvedValue([]);
    const { result } = renderHook(() => useSwapQuote({ mode: "send", amount: "5", from: "XLM", to: USDC }, 0), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    renderHook(() => useSwapQuote({ mode: "send", amount: "", from: "XLM", to: USDC }, 0), { wrapper });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
