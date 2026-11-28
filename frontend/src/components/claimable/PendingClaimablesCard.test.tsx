import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { api } from "@/lib/api";
import type { ClaimableBalance } from "@/lib/api/endpoints/account";
import { renderWithProviders } from "@/test/render";
import { PendingClaimablesCard } from "./PendingClaimablesCard";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const OTHER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const cb = (id: string, partial: Partial<ClaimableBalance> = {}): ClaimableBalance => ({
  id: id.repeat(72),
  asset: "native",
  amount: "3",
  sponsor: OTHER,
  lastModifiedLedger: 1,
  claimants: [{ destination: G, predicate: {} }],
  claimableNow: true,
  ...partial,
});

beforeEach(() => vi.restoreAllMocks());

describe("PendingClaimablesCard", () => {
  it("summarises balances ready to claim and links to the page", async () => {
    vi.spyOn(api.account, "claimableBalances").mockResolvedValue({
      items: [cb("a"), cb("b"), cb("c"), cb("d"), cb("e", { claimableNow: false })],
      nextCursor: null,
      hasMore: false,
    });
    renderWithProviders(<PendingClaimablesCard account={G} />);
    expect(await screen.findByText("4 claimable balances ready to claim")).toBeInTheDocument();
    expect(screen.getByText("and 1 more")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review and claim" })).toHaveAttribute("href", "/claimable");
  });

  it("renders nothing when there is nothing to claim", async () => {
    const list = vi.spyOn(api.account, "claimableBalances").mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    renderWithProviders(<PendingClaimablesCard account={G} />);
    await vi.waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.queryByText("Funds waiting for you")).not.toBeInTheDocument();
  });
});
