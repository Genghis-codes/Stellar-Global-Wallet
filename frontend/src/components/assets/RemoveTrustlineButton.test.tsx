import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { renderWithProviders } from "@/test/render";
import { RemoveTrustlineButton, canRemoveTrustline } from "./RemoveTrustlineButton";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const signTransaction = vi.fn(async (xdr: string, _opts?: unknown) => `signed:${xdr}`);
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction } }) }));

beforeEach(() => vi.restoreAllMocks());

describe("canRemoveTrustline", () => {
  const line = { asset_type: "credit_alphanum4" as const, asset_code: "USDC", asset_issuer: ISSUER, balance: "0.0000000" };
  it("requires a zero balance and no liabilities", () => {
    expect(canRemoveTrustline(line)).toBe(true);
    expect(canRemoveTrustline({ ...line, balance: "0.0000001" })).toBe(false);
    expect(canRemoveTrustline({ ...line, selling_liabilities: "1.0000000" })).toBe(false);
    expect(canRemoveTrustline({ asset_type: "native", balance: "0" })).toBe(false);
  });
});

describe("RemoveTrustlineButton", () => {
  it("confirms, then builds with limit 0, signs and submits", async () => {
    const build = vi.spyOn(api.wallet, "buildTrustline").mockResolvedValue({ xdr: "RM", networkPassphrase: "Test", reserveDelta: "-0.5", spendableXlmAfter: "10" });
    vi.spyOn(api.wallet, "submit").mockResolvedValue({ hash: "h", successful: true });
    const user = userEvent.setup();
    renderWithProviders(<RemoveTrustlineButton account={G} code="USDC" issuer={ISSUER} />);
    await user.click(screen.getByRole("button", { name: "Remove USDC" }));
    expect(screen.getByText(/returns its 0.5 XLM reserve/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove trustline" }));
    expect(await screen.findByText("USDC removed")).toBeInTheDocument();
    expect(build).toHaveBeenCalledWith({ account: G, asset: { code: "USDC", issuer: ISSUER }, limit: "0" });
  });
});
