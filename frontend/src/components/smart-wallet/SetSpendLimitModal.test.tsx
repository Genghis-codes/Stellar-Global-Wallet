import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import type { PreparedInvocation, SpendAllowance } from "@/lib/api/endpoints/contract";
import { renderWithProviders } from "@/test/render";
import { SetSpendLimitModal } from "./SetSpendLimitModal";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const signTransaction = vi.fn(async (xdr: string, _opts?: unknown) => `signed:${xdr}`);
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction } }) }));

const allowance: SpendAllowance = {
  assetCode: "USDC",
  unlimited: false,
  limit: "1000000000",
  spent: "300000000",
  remaining: "700000000",
  windowStartsAt: "2026-11-26T00:00:00.000Z",
  windowResetsAt: "2026-11-27T00:00:00.000Z",
  nextRefillAt: null,
};

const prepared = { xdr: "TX", networkPassphrase: "Test SDF Network ; September 2015" } as PreparedInvocation;

beforeEach(() => vi.restoreAllMocks());

describe("SetSpendLimitModal", () => {
  it("lowers a limit immediately", async () => {
    const build = vi.spyOn(api.contract, "buildSetSpendLimit").mockResolvedValue(prepared);
    vi.spyOn(api.contract, "submit").mockResolvedValue({ hash: "h", successful: true });
    const onQueued = vi.fn();
    renderWithProviders(<SetSpendLimitModal allowance={allowance} account={G} onClose={vi.fn()} onQueued={onQueued} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Limit per 24 hours"), "50");
    expect(screen.getByText("Lowering a limit applies immediately.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Set limit" }));
    await waitFor(() => expect(build).toHaveBeenCalledWith(G, "USDC", "50"));
    expect(onQueued).not.toHaveBeenCalled();
    expect(await screen.findByText("Spend limit lowered")).toBeInTheDocument();
  });

  it("warns about the 24 h delay and queues an increase", async () => {
    vi.spyOn(api.contract, "buildSetSpendLimit").mockResolvedValue(prepared);
    vi.spyOn(api.contract, "submit").mockResolvedValue({ hash: "h", successful: true });
    const onQueued = vi.fn();
    renderWithProviders(<SetSpendLimitModal allowance={allowance} account={G} onClose={vi.fn()} onQueued={onQueued} />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Remove the limit"));
    expect(screen.getByRole("status")).toHaveTextContent("24-hour delay");
    await user.click(screen.getByRole("button", { name: "Queue increase" }));
    await waitFor(() =>
      expect(onQueued).toHaveBeenCalledWith(
        expect.objectContaining({ assetCode: "USDC", limit: "0", previousLimit: "1000000000", hash: "h" }),
      ),
    );
  });

  it("refuses a limit below today's spending", async () => {
    renderWithProviders(<SetSpendLimitModal allowance={allowance} account={G} onClose={vi.fn()} onQueued={vi.fn()} />);
    await userEvent.setup().type(screen.getByLabelText("Limit per 24 hours"), "10");
    expect(screen.getByText(/already spent 30/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set limit" })).toBeDisabled();
  });
});
