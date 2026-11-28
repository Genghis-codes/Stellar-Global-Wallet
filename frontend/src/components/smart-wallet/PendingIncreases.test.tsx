import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import type { PreparedInvocation, SpendAllowance } from "@/lib/api/endpoints/contract";
import { pendingSpendLimitStore } from "@/lib/contract/spendLimit";
import { renderWithProviders } from "@/test/render";
import { SpendLimitsView } from "./SpendLimitsView";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const signTransaction = vi.fn(async (xdr: string, _opts?: unknown) => `signed:${xdr}`);
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction } }) }));

const usdc: SpendAllowance = {
  assetCode: "USDC",
  unlimited: false,
  limit: "1000000000",
  spent: "0",
  remaining: "1000000000",
  windowStartsAt: "2026-11-26T00:00:00.000Z",
  windowResetsAt: "2026-11-26T00:00:00.000Z",
  nextRefillAt: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  pendingSpendLimitStore(() => window.localStorage).save(G, {
    assetCode: "USDC",
    limit: "5000000000",
    previousLimit: "1000000000",
    effectiveAt: new Date(Date.now() + 3 * 3600_000 + 30_000).toISOString(),
  });
});

describe("pending spend-limit increases", () => {
  it("shows the countdown and cancels by re-setting the current limit", async () => {
    vi.spyOn(api.contract, "spendAllowances").mockResolvedValue([usdc]);
    const build = vi
      .spyOn(api.contract, "buildSetSpendLimit")
      .mockResolvedValue({ xdr: "TX", networkPassphrase: "Test SDF Network ; September 2015" } as PreparedInvocation);
    vi.spyOn(api.contract, "submit").mockResolvedValue({ hash: "h", successful: true });
    renderWithProviders(<SpendLimitsView />);
    expect(await screen.findByText("USDC: 100 USDC → 500 USDC")).toBeInTheDocument();
    expect(screen.getByText("3h 00m")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel increase" }));
    await waitFor(() => expect(build).toHaveBeenCalledWith(G, "USDC", "100"));
    expect(await screen.findByText("Increase cancelled")).toBeInTheDocument();
    expect(screen.queryByText("Pending increases")).not.toBeInTheDocument();
  });

  it("hides increases the contract already applied", async () => {
    vi.spyOn(api.contract, "spendAllowances").mockResolvedValue([{ ...usdc, limit: "5000000000" }]);
    renderWithProviders(<SpendLimitsView />);
    await screen.findByRole("heading", { name: "USDC" });
    expect(screen.queryByText("Pending increases")).not.toBeInTheDocument();
  });
});
