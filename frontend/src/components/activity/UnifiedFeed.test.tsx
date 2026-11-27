import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { api } from "@/lib/api";
import { renderWithProviders } from "@/test/render";
import { UnifiedFeed, activityItemHash } from "./UnifiedFeed";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const HASH = "c".repeat(64);

beforeEach(() => vi.restoreAllMocks());

describe("UnifiedFeed", () => {
  it("renders contract events with a link and claimable balances", async () => {
    vi.spyOn(api.account, "activity").mockResolvedValue({
      items: [
        { id: "e1", source: "contract_event", timestamp: "2026-01-02T00:00:00Z", type: "contract_event", details: { topic0: "transfer", transactionHash: HASH } },
        { id: "c1", source: "claimable_balance", timestamp: "2026-01-01T00:00:00Z", type: "create_claimable_balance", details: { amount: "4", asset: "native" } },
      ],
      hasMore: false,
    });
    renderWithProviders(<UnifiedFeed account={G} />);
    const list = await screen.findByRole("list", { name: "All activity" });
    expect(within(list).getByRole("link")).toHaveAttribute("href", `/activity/${HASH}`);
    expect(within(list).getByText("Contract event: transfer")).toBeInTheDocument();
    expect(within(list).getByText("Claimable balance created")).toBeInTheDocument();
  });

  it("only links valid hashes", () => {
    const base = { id: "1", source: "payment" as const, timestamp: "", type: "payment" };
    expect(activityItemHash({ ...base, details: { transactionHash: "nope" } })).toBeNull();
    expect(activityItemHash({ ...base, details: { transactionHash: HASH } })).toBe(HASH);
  });
});
