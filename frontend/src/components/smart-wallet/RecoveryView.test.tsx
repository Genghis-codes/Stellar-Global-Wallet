import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { api } from "@/lib/api";
import type { RecoveryState } from "@/lib/api/endpoints/contract";
import { renderWithProviders } from "@/test/render";
import { RecoveryView } from "./RecoveryView";

const ADMIN = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const G1 = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const G2 = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";
const NEW_ADMIN = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3";
const signTransaction = vi.fn(async (xdr: string, _opts?: unknown) => `signed:${xdr}`);
const auth = { account: G1 };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: auth.account, wallet: { signTransaction } }) }));

const baseState: RecoveryState = {
  guardians: [G1, G2],
  guardianCount: 2,
  config: { threshold: 2, delayInLedgers: 720 },
  configured: true,
  proposal: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
  auth.account = G1;
  vi.spyOn(api.contract, "admin").mockResolvedValue({ admin: ADMIN, pendingAdmin: null });
});

describe("RecoveryView", () => {
  it("shows the idle timeline and the user's role", async () => {
    vi.spyOn(api.contract, "recovery").mockResolvedValue(baseState);
    renderWithProviders(<RecoveryView />);
    expect(await screen.findByText("No recovery in progress")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Recovery progress" }).querySelector('[aria-current="step"]')).toHaveTextContent(
      "Initiate",
    );
    expect(screen.getByText(/You are the guardian/)).toBeInTheDocument();
  });

  it("tracks a proposal through the timelock", async () => {
    vi.spyOn(api.contract, "recovery").mockResolvedValue({
      ...baseState,
      proposal: {
        newAdmin: NEW_ADMIN,
        approvals: [G1, G2],
        approvalsCount: 2,
        threshold: 2,
        approvalsRemaining: 0,
        quorumReached: true,
        readyAtLedger: 2000,
        latestLedger: 1500,
        ledgersRemaining: 500,
        executableAt: new Date(Date.now() + 2_500_000).toISOString(),
        executable: false,
      },
    });
    renderWithProviders(<RecoveryView />);
    expect(await screen.findByText("Recovery in progress")).toBeInTheDocument();
    expect(screen.getByText(/Unlocks in/, { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Recovery progress" }).querySelector('[aria-current="step"]')).toHaveTextContent(
      "Timelock (current step)",
    );
  });

  it("explains when recovery isn't configured", async () => {
    vi.spyOn(api.contract, "recovery").mockResolvedValue({ ...baseState, config: null, configured: false });
    renderWithProviders(<RecoveryView />);
    expect(await screen.findByText("Recovery isn't set up")).toBeInTheDocument();
  });
});
