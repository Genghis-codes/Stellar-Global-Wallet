import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { renderWithProviders } from "@/test/render";
import { AllowancesView } from "./AllowancesView";
import { parseAsset } from "./GrantAssetModal";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const signTransaction = vi.fn(async (xdr: string, _opts?: unknown) => `signed:${xdr}`);
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction } }) }));

beforeEach(() => vi.restoreAllMocks());

describe("parseAsset", () => {
  it("normalises codes and requires an issuer except for XLM", () => {
    expect(parseAsset(" usdc ", ISSUER)).toEqual({ code: "USDC", issuer: ISSUER });
    expect(parseAsset("xlm", "")).toEqual({ code: "XLM", issuer: null });
    expect(parseAsset("USDC", "nope")).toMatchObject({ field: "issuer" });
    expect(parseAsset("TOO-LONG-CODE!", ISSUER)).toMatchObject({ field: "code" });
  });
});

describe("AllowancesView", () => {
  it("lists allowed assets with their remaining allowance", async () => {
    vi.spyOn(api.contract, "assets").mockResolvedValue([{ code: "USDC", issuer: ISSUER }]);
    vi.spyOn(api.contract, "spendAllowances").mockResolvedValue([
      {
        assetCode: "USDC",
        unlimited: false,
        limit: "1000000000",
        spent: "250000000",
        remaining: "750000000",
        windowStartsAt: "2026-11-26T00:00:00.000Z",
        windowResetsAt: "2026-11-27T00:00:00.000Z",
        nextRefillAt: null,
      },
    ]);
    renderWithProviders(<AllowancesView />);
    expect(await screen.findByRole("meter", { name: "USDC limit used" })).toHaveAttribute("aria-valuenow", "25");
  });

  it("grants a new asset", async () => {
    vi.spyOn(api.contract, "assets").mockResolvedValue([]);
    vi.spyOn(api.contract, "spendAllowances").mockResolvedValue([]);
    const build = vi.spyOn(api.contract, "buildAddAsset").mockResolvedValue({ xdr: "TX" });
    vi.spyOn(api.contract, "submit").mockResolvedValue({ hash: "h", successful: true });
    renderWithProviders(<AllowancesView />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: "Allow asset" }))[0]!);
    await user.type(screen.getByLabelText("Asset code"), "USDC");
    await user.click(screen.getByLabelText("Issuer"));
    await user.paste(ISSUER);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Allow asset" }));
    await waitFor(() => expect(build).toHaveBeenCalledWith(G, { code: "USDC", issuer: ISSUER }));
    expect(signTransaction).toHaveBeenCalledWith("TX", expect.any(Object));
  });

  it("revokes an asset after confirmation", async () => {
    vi.spyOn(api.contract, "assets").mockResolvedValue([{ code: "USDC", issuer: ISSUER }]);
    vi.spyOn(api.contract, "spendAllowances").mockResolvedValue([]);
    const build = vi.spyOn(api.contract, "buildRemoveAsset").mockResolvedValue({ xdr: "TX" });
    vi.spyOn(api.contract, "submit").mockResolvedValue({ hash: "h", successful: true });
    renderWithProviders(<AllowancesView />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Revoke USDC" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(build).toHaveBeenCalledWith(G, "USDC"));
    expect(await screen.findByText("USDC revoked")).toBeInTheDocument();
  });
});
