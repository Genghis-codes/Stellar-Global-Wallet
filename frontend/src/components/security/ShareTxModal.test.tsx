import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import type { PendingTx } from "@/lib/api/endpoints/pendingTxs";
import * as pendingTx from "@/lib/multisig/pendingTx";
import { renderWithProviders } from "@/test/render";
import { ShareTxModal } from "./ShareTxModal";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G }) }));

const summary = { source: G, fee: "100", sequence: "2", memo: null, operations: [], signatureCount: 1 };

beforeEach(() => vi.restoreAllMocks());

describe("ShareTxModal", () => {
  it("rejects text that isn't a transaction", async () => {
    renderWithProviders(<ShareTxModal open onClose={vi.fn()} account={G} />);
    await userEvent.setup().type(screen.getByLabelText("Transaction XDR"), "garbage");
    expect(screen.getByText("That isn't a transaction for this network.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
  });

  it("shares a decodable envelope", async () => {
    vi.spyOn(pendingTx, "summarizeTransaction").mockReturnValue(summary);
    const create = vi.spyOn(api.pendingTxs, "create").mockResolvedValue({ id: "p", status: "pending" } as PendingTx);
    const onClose = vi.fn();
    renderWithProviders(<ShareTxModal open onClose={onClose} account={G} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Transaction XDR"), "AAAA");
    expect(screen.getByText("0 operations · 1 signature")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("AAAA"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the server's reason when sharing is refused", async () => {
    vi.spyOn(pendingTx, "summarizeTransaction").mockReturnValue(summary);
    vi.spyOn(api.pendingTxs, "create").mockRejectedValue(
      new ApiError("Only signers of the source account can access this transaction", { status: 403, code: "FORBIDDEN" }),
    );
    renderWithProviders(<ShareTxModal open onClose={vi.fn()} account={G} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Transaction XDR"), "AAAA");
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only signers of the source account");
  });
});
