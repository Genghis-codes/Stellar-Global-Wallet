import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import type { ReservesResponse } from "@/lib/api/endpoints/account";
import { renderWithProviders } from "@/test/render";
import { DashboardView } from "./DashboardView";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G }) }));

const reserves: ReservesResponse = {
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
    {
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: ISSUER,
      balance: "25.5000000",
      spendable: "25.5",
    },
    { asset_type: "native", balance: "100.0000000", spendable: "98.5" },
  ],
};

const flags = { multisig: false, feeBump: false, pathPayments: false, recovery: false, priceOracle: false };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api.config, "flags").mockResolvedValue(flags);
  vi.spyOn(api.preferences, "get").mockResolvedValue({});
  vi.spyOn(api.account, "claimableBalances").mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
});

describe("DashboardView", () => {
  it("shows the XLM summary and the asset list", async () => {
    vi.spyOn(api.account, "reserves").mockResolvedValue(reserves);
    renderWithProviders(<DashboardView />);
    expect(await screen.findByText("Total XLM")).toBeInTheDocument();
    expect(screen.getByText("Locked").parentElement).toHaveTextContent("1.5XLM");
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("XLM");
    expect(items[1]).toHaveTextContent("USDC");
    expect(items[1]).toHaveTextContent("25.50USDC");
    expect(screen.queryByText("No price")).toBeNull();
    expect(screen.queryByRole("button", { name: "View XLM price" })).toBeNull();
  });

  it("shows the total portfolio value when prices are available", async () => {
    vi.spyOn(api.config, "flags").mockResolvedValue({ ...flags, priceOracle: true });
    vi.spyOn(api.account, "reserves").mockResolvedValue(reserves);
    const updatedAt = new Date().toISOString();
    vi.spyOn(api.price, "many").mockResolvedValue([
      { asset: "XLM", price: "0.1", currency: "USD", source: "stellar_dex", updatedAt },
      { asset: `USDC:${ISSUER}`, price: "1", currency: "USD", source: "stellar_dex", updatedAt },
    ]);
    renderWithProviders(<DashboardView />);
    expect(await screen.findByText("Total portfolio value")).toBeInTheDocument();
    expect(await screen.findByText("$35.50")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("$10.00");
    expect(items[1]).toHaveTextContent("$25.50");

    vi.spyOn(api.price, "history").mockResolvedValue({
      asset: "XLM",
      currency: "USD",
      range: "7d",
      resolution: "1h",
      intervalSeconds: 3600,
      source: "stellar_dex",
      from: updatedAt,
      to: updatedAt,
      points: [],
    });
    await userEvent.setup().click(screen.getByRole("button", { name: "View XLM price" }));
    expect(await screen.findByRole("dialog", { name: "XLM price" })).toBeInTheDocument();
  });

  it("offers Friendbot funding for an unfunded testnet account", async () => {
    vi.spyOn(api.account, "reserves").mockRejectedValue(
      new ApiError("not found", { status: 404, code: "ACCOUNT_NOT_FOUND" })
    );
    const fund = vi.spyOn(api.dev, "fund").mockResolvedValue({ account: G, funded: true, alreadyFunded: false });
    renderWithProviders(<DashboardView />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Fund with Friendbot" }));
    expect(fund).toHaveBeenCalledWith(G);
    expect(await screen.findByText("Account funded")).toBeInTheDocument();
  });

  it("shows a retryable error state", async () => {
    vi.spyOn(api.account, "reserves").mockRejectedValue(
      new ApiError("Horizon is unavailable", { status: 502, code: "HORIZON_UNAVAILABLE" })
    );
    renderWithProviders(<DashboardView />);
    expect(await screen.findByText("Couldn't load your balances")).toBeInTheDocument();
    expect(screen.getByText("Horizon is unavailable")).toBeInTheDocument();
  });
});

describe("DashboardView hidden assets", () => {
  it("leaves hidden assets out of the balance list", async () => {
    vi.spyOn(api.account, "reserves").mockResolvedValue(reserves);
    vi.spyOn(api.preferences, "get").mockResolvedValue({ hiddenAssets: [`USDC:${ISSUER}`] });
    renderWithProviders(<DashboardView />);
    expect(await screen.findByText("1 asset, 1 hidden")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/assets");
  });
});
