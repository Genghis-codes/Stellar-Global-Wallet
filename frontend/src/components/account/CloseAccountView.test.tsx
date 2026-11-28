import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import type { CloseAccountDryRun } from "@/lib/api/endpoints/account";
import { renderWithProviders } from "@/test/render";
import { CloseAccountView, destinationError } from "./CloseAccountView";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const D = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const signTransaction = vi.fn(async (xdr: string, _opts?: unknown) => `signed:${xdr}`);
const signOut = vi.fn(async () => {});
const push = vi.fn();
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction }, signOut }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: push }) }));

const dryRun: CloseAccountDryRun = {
  xdr: "X",
  networkPassphrase: "Test",
  operations: [{ type: "removeTrustline", asset: `USDC:${D}` }, { type: "accountMerge", destination: D }],
  operationCount: 2,
  reserveRecovered: "99.5",
  estimatedReserve: "1.5",
  blocking: [],
  canClose: true,
};

beforeEach(() => vi.restoreAllMocks());

describe("destinationError", () => {
  it("requires a different valid account", () => {
    expect(destinationError("", G)).toMatch(/Enter the account/);
    expect(destinationError("nope", G)).toMatch(/valid Stellar account/);
    expect(destinationError(G, G)).toMatch(/different account/);
    expect(destinationError(D, G)).toBeNull();
  });
});

describe("CloseAccountView", () => {
  it("previews the close steps for a destination", async () => {
    const preview = vi.spyOn(api.account, "closeDryRun").mockResolvedValue(dryRun);
    const user = userEvent.setup();
    renderWithProviders(<CloseAccountView />);
    expect(screen.getByRole("note")).toHaveTextContent("can't be undone");
    await user.type(screen.getByLabelText("Destination account"), D);
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Remove the USDC trustline")).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith(G, D);
  });

  it("shows why an account can't be closed", async () => {
    vi.spyOn(api.account, "closeDryRun").mockResolvedValue({
      ...dryRun,
      canClose: false,
      blocking: [{ code: "SPONSORED_TRUSTLINE", message: "A trustline is sponsored by another account." }],
    });
    const user = userEvent.setup();
    renderWithProviders(<CloseAccountView />);
    await user.type(screen.getByLabelText("Destination account"), D);
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("sponsored by another account");
  });

  it("does not preview an invalid destination", async () => {
    const preview = vi.spyOn(api.account, "closeDryRun");
    renderWithProviders(<CloseAccountView />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText("Enter the account that receives your funds.")).toBeInTheDocument();
    expect(preview).not.toHaveBeenCalled();
  });

  it("requires the typed confirmation, then signs, submits and signs out", async () => {
    vi.spyOn(api.account, "closeDryRun").mockResolvedValue(dryRun);
    const build = vi.spyOn(api.account, "buildClose").mockResolvedValue({ xdr: "CLOSE", networkPassphrase: "Test", operations: [], operationCount: 2 });
    const submit = vi.spyOn(api.wallet, "submit").mockResolvedValue({ hash: "h", successful: true });
    const user = userEvent.setup();
    renderWithProviders(<CloseAccountView />);
    await user.type(screen.getByLabelText("Destination account"), D);
    await user.click(screen.getByRole("button", { name: "Preview" }));

    const closeButton = await screen.findByRole("button", { name: "Close account" });
    expect(closeButton).toBeDisabled();
    await user.type(screen.getByLabelText("Confirmation"), "close account");
    expect(closeButton).toBeDisabled();
    await user.clear(screen.getByLabelText("Confirmation"));
    await user.type(screen.getByLabelText("Confirmation"), "CLOSE ACCOUNT");
    await user.click(closeButton);

    expect(await screen.findByText("Account closed")).toBeInTheDocument();
    expect(build).toHaveBeenCalledWith(G, D);
    expect(submit).toHaveBeenCalledWith("signed:CLOSE", { account: G });
    expect(signOut).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/");
  });
});
