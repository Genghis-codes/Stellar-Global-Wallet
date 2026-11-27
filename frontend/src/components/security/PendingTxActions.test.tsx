import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import type { PendingTx } from "@/lib/api/endpoints/pendingTxs";
import { WalletError } from "@/lib/wallet/types";
import { renderWithProviders } from "@/test/render";
import { PendingTxActions } from "./PendingTxActions";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const signTransaction = vi.fn(async (xdr: string, _opts?: unknown) => `signed:${xdr}`);
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction } }) }));

function pendingTx(overrides: Partial<PendingTx> = {}): PendingTx {
  return {
    id: "tx-1",
    account: G,
    xdr: "AAAA",
    requiredWeight: 2,
    collectedSigners: [B],
    createdBy: B,
    expiresAt: null,
    status: "pending",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    hash: "ab".repeat(32),
    collectedWeight: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  signTransaction.mockClear();
});

describe("PendingTxActions: co-sign", () => {
  it("signs in the wallet and posts the signatures", async () => {
    const add = vi
      .spyOn(api.pendingTxs, "addSignatures")
      .mockResolvedValue(pendingTx({ status: "ready", collectedSigners: [B, G], collectedWeight: 2 }));
    renderWithProviders(<PendingTxActions tx={pendingTx()} account={G} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Co-sign" }));
    await waitFor(() => expect(add).toHaveBeenCalledWith("tx-1", "signed:AAAA"));
    expect(await screen.findByText("Signed: ready to submit")).toBeInTheDocument();
  });

  it("stays quiet when the user rejects in the wallet", async () => {
    signTransaction.mockRejectedValueOnce(new WalletError("USER_REJECTED", "no"));
    const add = vi.spyOn(api.pendingTxs, "addSignatures");
    renderWithProviders(<PendingTxActions tx={pendingTx()} account={G} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Co-sign" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Co-sign" })).toBeEnabled());
    expect(add).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("hides co-sign once the user signed", () => {
    renderWithProviders(<PendingTxActions tx={pendingTx({ collectedSigners: [G] })} account={G} />);
    expect(screen.queryByRole("button", { name: "Co-sign" })).not.toBeInTheDocument();
    expect(screen.getByText("You signed this.")).toBeInTheDocument();
  });
});

describe("PendingTxActions: submit", () => {
  it("submits a ready transaction with an idempotency key", async () => {
    const submit = vi.spyOn(api.multisig, "submit").mockResolvedValue({ hash: "h", successful: true });
    const ready = pendingTx({ status: "ready", collectedSigners: [B, G], collectedWeight: 2 });
    renderWithProviders(<PendingTxActions tx={ready} account={G} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith("AAAA", "pending-tx:tx-1"));
    expect(await screen.findByText("Transaction submitted")).toBeInTheDocument();
  });

  it("leaves submitting to the source account", () => {
    const ready = pendingTx({ account: B, status: "ready", collectedSigners: [B, G], collectedWeight: 2 });
    renderWithProviders(<PendingTxActions tx={ready} account={G} />);
    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
    expect(screen.getByText(/account owner can submit/)).toBeInTheDocument();
  });
});

describe("PendingTxActions: cancel", () => {
  it("lets the creator cancel after confirming", async () => {
    const cancel = vi.spyOn(api.pendingTxs, "cancel").mockResolvedValue(pendingTx({ status: "cancelled" }));
    renderWithProviders(<PendingTxActions tx={pendingTx({ createdBy: G, collectedSigners: [G] })} account={G} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel transaction" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith("tx-1"));
    expect(await screen.findByText("Transaction cancelled")).toBeInTheDocument();
  });

  it("is not offered to other signers", () => {
    renderWithProviders(<PendingTxActions tx={pendingTx()} account={G} />);
    expect(screen.queryByRole("button", { name: "Cancel transaction" })).not.toBeInTheDocument();
  });
});
