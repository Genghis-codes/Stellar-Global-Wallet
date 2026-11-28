import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import type { PreparedInvocation, RecoveryState } from "@/lib/api/endpoints/contract";
import { renderWithProviders } from "@/test/render";
import { GuardiansView } from "./GuardiansView";

const ADMIN = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const G1 = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const G2 = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";
const signTransaction = vi.fn(async (xdr: string, _opts?: unknown) => `signed:${xdr}`);
const auth = { account: ADMIN };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: auth.account, wallet: { signTransaction } }) }));

const state: RecoveryState = {
  guardians: [G1, G2],
  guardianCount: 2,
  config: { threshold: 2, delayInLedgers: 17280 },
  configured: true,
  proposal: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
  auth.account = ADMIN;
  vi.spyOn(api.contract, "admin").mockResolvedValue({ admin: ADMIN, pendingAdmin: null });
});

describe("GuardiansView", () => {
  it("shows the threshold, delay and guardians", async () => {
    vi.spyOn(api.contract, "recovery").mockResolvedValue(state);
    renderWithProviders(<GuardiansView />);
    expect(await screen.findByText("2 registered")).toBeInTheDocument();
    expect(screen.getByText(/of 2 guardians must approve/)).toHaveTextContent("1d 0h");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("explains an unconfigured contract", async () => {
    vi.spyOn(api.contract, "recovery").mockResolvedValue({ ...state, config: null, configured: false });
    renderWithProviders(<GuardiansView />);
    expect(await screen.findByText(/Recovery isn't configured/)).toBeInTheDocument();
  });

  it("lets the admin queue a new guardian", async () => {
    vi.spyOn(api.contract, "recovery").mockResolvedValue(state);
    const build = vi.spyOn(api.contract, "buildAddGuardian").mockResolvedValue({ xdr: "TX" } as PreparedInvocation);
    vi.spyOn(api.contract, "submit").mockResolvedValue({ hash: "h", successful: true });
    renderWithProviders(<GuardiansView />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add guardian" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByLabelText("Guardian account"));
    await user.paste("GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3");
    expect(within(dialog).getByRole("status")).toHaveTextContent("queued");
    await user.click(within(dialog).getByRole("button", { name: "Add guardian" }));
    await waitFor(() => expect(build).toHaveBeenCalledWith(ADMIN, "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3"));
    expect(await screen.findByText("Change queued")).toBeInTheDocument();
  });

  it("blocks removing a guardian below the threshold", async () => {
    vi.spyOn(api.contract, "recovery").mockResolvedValue(state);
    renderWithProviders(<GuardiansView />);
    await userEvent.setup().click(await screen.findByRole("button", { name: `Remove guardian ${G1}` }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("at least 2 guardians must remain");
    expect(within(dialog).getByRole("button", { name: "Remove guardian" })).toBeDisabled();
  });

  it("hides management from non-admins", async () => {
    auth.account = G1;
    vi.spyOn(api.contract, "recovery").mockResolvedValue(state);
    renderWithProviders(<GuardiansView />);
    expect(await screen.findByText("Only the contract admin can add or remove guardians.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add guardian" })).not.toBeInTheDocument();
  });
});
