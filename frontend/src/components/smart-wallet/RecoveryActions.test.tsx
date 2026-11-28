import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import type { PreparedInvocation, RecoveryProposal, RecoveryState } from "@/lib/api/endpoints/contract";
import { recoveryPermissions } from "@/lib/contract/recovery";
import { renderWithProviders } from "@/test/render";
import { RecoveryActions } from "./RecoveryActions";

const ADMIN = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const G1 = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const G2 = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";
const G3 = "GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR";
const NEW_ADMIN = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3";
const signTransaction = vi.fn(async (xdr: string, _opts?: unknown) => `signed:${xdr}`);
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G1, wallet: { signTransaction } }) }));

const idle: RecoveryState = {
  guardians: [G1, G2, G3],
  guardianCount: 3,
  config: { threshold: 2, delayInLedgers: 720 },
  configured: true,
  proposal: null,
};

function withProposal(overrides: Partial<RecoveryProposal> = {}): RecoveryState {
  return {
    ...idle,
    proposal: {
      newAdmin: NEW_ADMIN,
      approvals: [G2],
      approvalsCount: 1,
      threshold: 2,
      approvalsRemaining: 1,
      quorumReached: false,
      readyAtLedger: null,
      latestLedger: 1000,
      ledgersRemaining: null,
      executableAt: null,
      executable: false,
      ...overrides,
    },
  };
}

function renderFor(account: string, state: RecoveryState) {
  return renderWithProviders(
    <RecoveryActions account={account} state={state} permissions={recoveryPermissions(account, state, ADMIN)} />,
  );
}

const prepared = { xdr: "TX" } as PreparedInvocation;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api.contract, "submit").mockResolvedValue({ hash: "h", successful: true });
});

describe("RecoveryActions: guardians", () => {
  it("lets a guardian start a recovery", async () => {
    const build = vi.spyOn(api.contract, "buildInitiateRecovery").mockResolvedValue(prepared);
    renderFor(G1, idle);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("New admin account"), NEW_ADMIN);
    await user.click(screen.getByRole("button", { name: "Start recovery" }));
    await waitFor(() => expect(build).toHaveBeenCalledWith(G1, NEW_ADMIN));
    expect(await screen.findByText("Recovery started")).toBeInTheDocument();
  });

  it("approves an open proposal", async () => {
    const build = vi.spyOn(api.contract, "buildApproveRecovery").mockResolvedValue(prepared);
    renderFor(G1, withProposal());
    await userEvent.setup().click(screen.getByRole("button", { name: "Approve recovery" }));
    await waitFor(() => expect(build).toHaveBeenCalledWith(G1));
  });

  it("withdraws an approval", async () => {
    const build = vi.spyOn(api.contract, "buildRevokeRecoveryApproval").mockResolvedValue(prepared);
    renderFor(G1, withProposal({ approvals: [G1, G2], approvalsCount: 2, quorumReached: true }));
    expect(screen.getByText(/stops the timelock/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Withdraw approval" }));
    await waitFor(() => expect(build).toHaveBeenCalledWith(G1));
  });

  it("offers nothing to outsiders", () => {
    renderFor(NEW_ADMIN, withProposal());
    expect(screen.getByText("You are neither the admin nor a guardian.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
