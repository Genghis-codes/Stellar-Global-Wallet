import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import type { ReservesResponse } from "@/lib/api/endpoints/account";
import { renderWithProviders } from "@/test/render";
import { AssetsView } from "./AssetsView";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G }) }));

const reserves: ReservesResponse = {
  reserves: { baseReserve: "0.5", subentryCount: 2, numSponsoring: 0, numSponsored: 0, minimumBalance: "2", sellingLiabilities: "0", spendable: "98" },
  balances: [
    { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: ISSUER, balance: "25.0000000", spendable: "25.0000000" },
    { asset_type: "credit_alphanum4", asset_code: "SPAM", asset_issuer: ISSUER, balance: "0.0000000", spendable: "0.0000000" },
    { asset_type: "native", balance: "100.0000000", spendable: "98" },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api.account, "reserves").mockResolvedValue(reserves);
  vi.spyOn(api.assets, "verified").mockResolvedValue({
    network: "testnet",
    assets: [{ code: "USDC", issuer: ISSUER, domain: "centre.io", name: "USD Coin" }],
  });
});

describe("AssetsView", () => {
  it("lists balances native first with verified badges and detail links", async () => {
    vi.spyOn(api.preferences, "get").mockResolvedValue({});
    renderWithProviders(<AssetsView />);
    const list = await screen.findByRole("list", { name: "Assets" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("XLM");
    expect(await within(items[2]!).findByText("Verified")).toBeInTheDocument();
    expect(within(items[2]!).getByRole("link", { name: /USDC/ })).toHaveAttribute("href", `/assets/USDC/${ISSUER}`);
  });

  it("hides assets listed in preferences and can show them", async () => {
    vi.spyOn(api.preferences, "get").mockResolvedValue({ hiddenAssets: [`SPAM:${ISSUER}`] });
    renderWithProviders(<AssetsView />);
    expect(await screen.findByText("3 assets, 1 hidden")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /SPAM/ })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Show hidden assets" }));
    expect(screen.getByRole("link", { name: /SPAM/ })).toBeInTheDocument();
  });

  it("saves hide choices to preferences", async () => {
    vi.spyOn(api.preferences, "get").mockResolvedValue({});
    const update = vi.spyOn(api.preferences, "update").mockResolvedValue({ hiddenAssets: [`USDC:${ISSUER}`] });
    renderWithProviders(<AssetsView />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Hide USDC" }));
    expect(update).toHaveBeenCalledWith({ hiddenAssets: [`USDC:${ISSUER}`] });
  });
});
