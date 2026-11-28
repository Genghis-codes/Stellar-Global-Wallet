import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { renderWithProviders } from "@/test/render";
import { AddAssetModal } from "./AddAssetModal";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const signTransaction = vi.fn(async (xdr: string, _opts?: unknown) => `signed:${xdr}`);
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction } }) }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api.assets, "verified").mockResolvedValue({
    network: "testnet",
    assets: [{ code: "USDC", issuer: ISSUER, domain: "centre.io", name: "USD Coin" }],
  });
});

describe("AddAssetModal", () => {
  it("adds a verified asset: build, sign, submit, toast", async () => {
    const build = vi
      .spyOn(api.wallet, "buildTrustline")
      .mockResolvedValue({ xdr: "TL", networkPassphrase: "Test", reserveDelta: "0.5", spendableXlmAfter: "9" });
    const submit = vi.spyOn(api.wallet, "submit").mockResolvedValue({ hash: "h", successful: true });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<AddAssetModal open onClose={onClose} account={G} held={new Set()} />);

    await user.click(await screen.findByRole("button", { name: "Select USDC from centre.io" }));
    expect(screen.getByText(/locks 0.5 XLM/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add trustline" }));

    expect(await screen.findByText("USDC added")).toBeInTheDocument();
    expect(build).toHaveBeenCalledWith({ account: G, asset: { code: "USDC", issuer: ISSUER } });
    expect(submit).toHaveBeenCalledWith("signed:TL", { account: G });
    expect(onClose).toHaveBeenCalled();
  });

  it("searches by code and warns about risky unverified assets", async () => {
    const search = vi.spyOn(api.assets, "search").mockResolvedValue({
      results: [{ code: "USDC", issuer: ISSUER, homeDomain: "usdc-coin.xyz", numAccounts: 3, verified: false, riskLevel: "critical", riskFactors: ["unverified"] }],
      nextCursor: null,
    });
    const user = userEvent.setup();
    renderWithProviders(<AddAssetModal open onClose={vi.fn()} account={G} held={new Set()} />);
    await user.type(screen.getByLabelText("Search assets"), "usdc");
    await waitFor(() => expect(search).toHaveBeenCalledWith({ code: "USDC" }, expect.anything()));
    expect(await screen.findByText("critical risk")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Select USDC from usdc-coin.xyz" }));
    expect(screen.getByRole("alert")).toHaveTextContent("isn't verified");
  });

  it("marks assets the account already holds", async () => {
    renderWithProviders(<AddAssetModal open onClose={vi.fn()} account={G} held={new Set([`USDC:${ISSUER}`])} />);
    expect(await screen.findByRole("button", { name: "Select USDC from centre.io" })).toBeDisabled();
  });
});
