import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { renderWithProviders } from "@/test/render";
import { AssetDetailView } from "./AssetDetailView";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const signTransaction = vi.fn(async (xdr: string, _opts?: unknown) => `signed:${xdr}`);
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction } }) }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api.preferences, "get").mockResolvedValue({});
  vi.spyOn(api.assets, "verified").mockResolvedValue({ network: "testnet", assets: [{ code: "USDC", issuer: ISSUER, domain: "centre.io", name: "USD Coin" }] });
  vi.spyOn(api.account, "reserves").mockResolvedValue({
    reserves: { baseReserve: "0.5", subentryCount: 1, numSponsoring: 0, numSponsored: 0, minimumBalance: "1.5", sellingLiabilities: "0", spendable: "1" },
    balances: [{ asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: ISSUER, balance: "12.5000000", spendable: "12.5000000" }],
  });
});

describe("AssetDetailView", () => {
  it("shows stellar.toml details, the verified badge and the balance", async () => {
    vi.spyOn(api.assets, "metadata").mockResolvedValue({
      code: "USDC",
      issuer: ISSUER,
      name: "USD Coin",
      desc: "A dollar stablecoin",
      image: null,
      decimals: 2,
      homeDomain: "centre.io",
      orgName: "Centre",
      status: "ok",
    });
    renderWithProviders(<AssetDetailView code="USDC" issuer={ISSUER} />);
    expect(await screen.findByRole("heading", { name: "USD Coin" })).toBeInTheDocument();
    expect(screen.getByText("A dollar stablecoin")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "centre.io" })).toHaveAttribute("href", "https://centre.io");
    expect(await screen.findByText("Verified")).toBeInTheDocument();
    expect(await screen.findByText("12.50")).toBeInTheDocument();
  });

  it("explains missing metadata", async () => {
    vi.spyOn(api.assets, "metadata").mockResolvedValue({
      code: "USDC", issuer: ISSUER, name: null, desc: null, image: null, decimals: 7, homeDomain: null, orgName: null, status: "no_home_domain",
    });
    renderWithProviders(<AssetDetailView code="USDC" issuer={ISSUER} />);
    expect(await screen.findByRole("note")).toHaveTextContent("hasn't set a home domain");
  });

  it("rejects malformed assets", () => {
    renderWithProviders(<AssetDetailView code="??" issuer="nope" />);
    expect(screen.getByText("Unknown asset")).toBeInTheDocument();
  });

  it("offers to add a trustline for an asset the account doesn't hold", async () => {
    const OTHER = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";
    vi.spyOn(api.assets, "metadata").mockResolvedValue({
      code: "EURC", issuer: OTHER, name: null, desc: null, image: null, decimals: 7, homeDomain: null, orgName: null, status: "ok",
    });
    const build = vi.spyOn(api.wallet, "buildTrustline").mockResolvedValue({ xdr: "TL", networkPassphrase: "Test", reserveDelta: "0.5", spendableXlmAfter: "1" });
    vi.spyOn(api.wallet, "submit").mockResolvedValue({ hash: "h", successful: true });
    renderWithProviders(<AssetDetailView code="EURC" issuer={OTHER} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /Add trustline/ }));
    expect(await screen.findByText("EURC added")).toBeInTheDocument();
    expect(build).toHaveBeenCalledWith({ account: G, asset: { code: "EURC", issuer: OTHER } });
  });

  it("can hide a held asset", async () => {
    vi.spyOn(api.assets, "metadata").mockResolvedValue({
      code: "USDC", issuer: ISSUER, name: null, desc: null, image: null, decimals: 7, homeDomain: null, orgName: null, status: "ok",
    });
    const update = vi.spyOn(api.preferences, "update").mockResolvedValue({ hiddenAssets: [`USDC:${ISSUER}`] });
    renderWithProviders(<AssetDetailView code="USDC" issuer={ISSUER} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Hide from balances" }));
    expect(update).toHaveBeenCalledWith({ hiddenAssets: [`USDC:${ISSUER}`] });
  });
});
