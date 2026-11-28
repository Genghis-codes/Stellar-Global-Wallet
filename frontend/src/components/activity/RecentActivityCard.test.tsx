import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { api } from "@/lib/api";
import { renderWithProviders } from "@/test/render";
import { RecentActivityCard } from "./RecentActivityCard";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const OTHER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

beforeEach(() => vi.restoreAllMocks());

describe("RecentActivityCard", () => {
  it("shows the latest payments and links to the full list", async () => {
    const payments = vi.spyOn(api.account, "payments").mockResolvedValue({
      items: [{ id: "1", type: "payment", transactionHash: "f".repeat(64), createdAt: "2026-01-01T00:00:00Z", from: OTHER, to: G, amount: "2", assetType: "native", flags: [] }],
      nextCursor: null,
      hasMore: false,
    });
    renderWithProviders(<RecentActivityCard account={G} />);
    const list = await screen.findByRole("list", { name: "Recent activity" });
    expect(within(list).getByText("Received")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute("href", "/activity");
    expect(payments).toHaveBeenCalledWith(G, { limit: 5 }, expect.anything());
  });

  it("says so when there are no payments", async () => {
    vi.spyOn(api.account, "payments").mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    renderWithProviders(<RecentActivityCard account={G} />);
    expect(await screen.findByText("No payments yet.")).toBeInTheDocument();
  });
});
