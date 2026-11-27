import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import type { FeatureFlags } from "@/lib/api/endpoints/config";
import { testQueryClient } from "@/test/render";
import { useAssetPrices, usePortfolioValue } from "./usePrices";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G }) }));

const flags = (priceOracle: boolean): FeatureFlags => ({
  multisig: false,
  feeBump: false,
  pathPayments: false,
  recovery: false,
  priceOracle,
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={testQueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api.preferences, "get").mockResolvedValue({ currency: "EUR" });
});

describe("price hooks", () => {
  it("does not request prices while the oracle flag is off", async () => {
    const flagsSpy = vi.spyOn(api.config, "flags").mockResolvedValue(flags(false));
    const many = vi.spyOn(api.price, "many");
    const { result } = renderHook(() => useAssetPrices(["XLM"]), { wrapper });
    await waitFor(() => expect(flagsSpy).toHaveBeenCalled());
    expect(result.current.fetchStatus).toBe("idle");
    expect(many).not.toHaveBeenCalled();
  });

  it("values the account's balances in USD when the preferred currency has no rates", async () => {
    vi.spyOn(api.config, "flags").mockResolvedValue(flags(true));
    vi.spyOn(api.account, "reserves").mockResolvedValue({
      reserves: {
        baseReserve: "0.5",
        subentryCount: 1,
        numSponsoring: 0,
        numSponsored: 0,
        minimumBalance: "1.5",
        sellingLiabilities: "0",
        spendable: "98.5",
      },
      balances: [
        { asset_type: "native", balance: "100.0000000", spendable: "98.5" },
        { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: ISSUER, balance: "5", spendable: "5" },
      ],
    });
    const now = new Date().toISOString();
    const many = vi.spyOn(api.price, "many").mockResolvedValue([
      { asset: "XLM", price: "0.1", currency: "USD", source: "stellar_dex", updatedAt: now },
      { asset: `USDC:${ISSUER}`, price: "1", currency: "USD", source: "stellar_dex", updatedAt: now },
    ]);

    const { result } = renderHook(() => usePortfolioValue(G), { wrapper });
    await waitFor(() => expect(result.current.valuation?.total).toBe("15"));
    expect(many).toHaveBeenCalledWith(["XLM", `USDC:${ISSUER}`], expect.anything());
    await waitFor(() => expect(result.current.currencyFallback).toBe(true));
    expect(result.current.currency).toBe("USD");
  });
});
