import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { api } from "@/lib/api";
import type { ReservesResponse } from "@/lib/api/endpoints/account";
import { renderWithProviders } from "@/test/render";
import { SwapView } from "./SwapView";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: {} }) }));

const flags = { multisig: true, feeBump: true, pathPayments: true, recovery: false, priceOracle: false };
const reserves = (withUsdc: boolean): ReservesResponse => ({
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
    { asset_type: "native", balance: "100", spendable: "98.5" },
    ...(withUsdc
      ? [{ asset_type: "credit_alphanum4" as const, asset_code: "USDC", asset_issuer: ISSUER, balance: "5", spendable: "5" }]
      : []),
  ],
});

afterEach(() => vi.restoreAllMocks());

describe("SwapView", () => {
  it("renders the swap form when the account holds two assets", async () => {
    vi.spyOn(api.config, "flags").mockResolvedValue(flags);
    vi.spyOn(api.account, "reserves").mockResolvedValue(reserves(true));
    renderWithProviders(<SwapView />);
    expect(await screen.findByLabelText("You pay")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review swap" })).toBeDisabled();
  });

  it("asks for a second asset first", async () => {
    vi.spyOn(api.config, "flags").mockResolvedValue(flags);
    vi.spyOn(api.account, "reserves").mockResolvedValue(reserves(false));
    renderWithProviders(<SwapView />);
    expect(await screen.findByText("Add another asset to swap")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage assets" })).toHaveAttribute("href", "/assets");
  });

  it("respects the pathPayments feature flag", async () => {
    vi.spyOn(api.config, "flags").mockResolvedValue({ ...flags, pathPayments: false });
    vi.spyOn(api.account, "reserves").mockResolvedValue(reserves(true));
    renderWithProviders(<SwapView />);
    expect(await screen.findByText("Swaps aren't available")).toBeInTheDocument();
  });
});
