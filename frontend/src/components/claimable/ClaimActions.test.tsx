import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import type { ClaimableBalance } from "@/lib/api/endpoints/account";
import { renderWithProviders } from "@/test/render";
import { ClaimActions } from "./ClaimActions";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const OTHER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ID = "a".repeat(72);
const signTransaction = vi.fn(async (xdr: string, _opts?: unknown) => `signed:${xdr}`);
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction } }) }));

const cb = (partial: Partial<ClaimableBalance> = {}): ClaimableBalance => ({
  id: ID,
  asset: `USDC:${OTHER}`,
  amount: "5",
  sponsor: OTHER,
  lastModifiedLedger: 1,
  claimants: [{ destination: G, predicate: {} }],
  claimableNow: true,
  ...partial,
});

const build = { xdr: "CL", networkPassphrase: "Test", balanceId: ID, asset: `USDC:${OTHER}`, amount: "5", createdTrustline: true };

beforeEach(() => vi.restoreAllMocks());

describe("ClaimActions", () => {
  it("claims, noting the trustline the build adds", async () => {
    const claim = vi.spyOn(api.account, "buildClaim").mockResolvedValue(build);
    const submit = vi.spyOn(api.wallet, "submit").mockResolvedValue({ hash: "h", successful: true });
    renderWithProviders(<ClaimActions balance={cb()} account={G} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Claim" }));
    expect(await screen.findByText("USDC claimed")).toBeInTheDocument();
    expect(screen.getByText(/trustline was added/)).toBeInTheDocument();
    expect(claim).toHaveBeenCalledWith(G, ID);
    expect(submit).toHaveBeenCalledWith("signed:CL", { account: G });
  });

  it("reclaims balances the account sent", async () => {
    const reclaim = vi.spyOn(api.account, "buildReclaim").mockResolvedValue({ ...build, createdTrustline: false });
    vi.spyOn(api.wallet, "submit").mockResolvedValue({ hash: "h", successful: true });
    renderWithProviders(<ClaimActions balance={cb({ sponsor: G })} account={G} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Reclaim" }));
    expect(await screen.findByText("USDC reclaimed")).toBeInTheDocument();
    expect(reclaim).toHaveBeenCalledWith(G, ID);
  });

  it("renders nothing for balances that can't be claimed yet", () => {
    renderWithProviders(<ClaimActions balance={cb({ claimableNow: false })} account={G} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
