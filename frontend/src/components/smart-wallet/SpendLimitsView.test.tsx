import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { api } from "@/lib/api";
import type { SpendAllowance } from "@/lib/api/endpoints/contract";
import { renderWithProviders } from "@/test/render";
import { SpendLimitsView } from "./SpendLimitsView";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction: vi.fn() } }) }));

const allowance = (overrides: Partial<SpendAllowance>): SpendAllowance => ({
  assetCode: "USDC",
  unlimited: false,
  limit: "1000000000",
  spent: "800000000",
  remaining: "200000000",
  windowStartsAt: "2026-11-26T00:00:00.000Z",
  windowResetsAt: "2026-11-27T00:00:00.000Z",
  nextRefillAt: null,
  ...overrides,
});

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("SpendLimitsView", () => {
  it("shows spent, remaining and the limit per asset", async () => {
    vi.spyOn(api.contract, "spendAllowances").mockResolvedValue([
      allowance({}),
      allowance({ assetCode: "XLM", unlimited: true, limit: "0", spent: "0", remaining: null }),
    ]);
    renderWithProviders(<SpendLimitsView />);
    const items = await screen.findAllByRole("listitem");
    expect(within(items[0]!).getByRole("meter")).toHaveAttribute("aria-valuenow", "80");
    expect(items[0]).toHaveTextContent("left of");
    expect(items[1]).toHaveTextContent("Unlimited");
    expect(items[1]).toHaveTextContent("No limit");
  });

  it("explains an empty wallet", async () => {
    vi.spyOn(api.contract, "spendAllowances").mockResolvedValue([]);
    renderWithProviders(<SpendLimitsView />);
    expect(await screen.findByText("No assets on the wallet yet")).toBeInTheDocument();
  });
});
