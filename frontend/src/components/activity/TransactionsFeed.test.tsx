import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { api } from "@/lib/api";
import { renderWithProviders } from "@/test/render";
import { TransactionsFeed, renderTransactionSummary } from "./TransactionsFeed";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const tx = { id: "1", hash: "b".repeat(64), ledger: 42, created_at: "2026-01-01T00:00:00Z", operation_count: 3, memo: "rent" };

beforeEach(() => vi.restoreAllMocks());

describe("TransactionsFeed", () => {
  it("summarises transactions and links to the detail page", async () => {
    vi.spyOn(api.account, "transactions").mockResolvedValue({ items: [tx], nextCursor: null, hasMore: false });
    renderWithProviders(<TransactionsFeed account={G} />);
    const list = await screen.findByRole("list", { name: "Transactions" });
    expect(within(list).getByText("Transaction · 3 operations")).toBeInTheDocument();
    expect(within(list).getByRole("link")).toHaveAttribute("href", `/activity/${tx.hash}`);
    expect(list).toHaveTextContent("Memo: rent");
  });

  it("falls back to the ledger when there is no memo", () => {
    expect(renderTransactionSummary({ ...tx, memo: undefined, operation_count: 1 })).toMatchObject({
      title: "Transaction · 1 operation",
      description: "Ledger 42",
    });
  });

  it("shows an empty state", async () => {
    vi.spyOn(api.account, "transactions").mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    renderWithProviders(<TransactionsFeed account={G} />);
    expect(await screen.findByText("No transactions yet")).toBeInTheDocument();
  });
});
