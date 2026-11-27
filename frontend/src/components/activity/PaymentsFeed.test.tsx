import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import type { PaymentHistoryItem } from "@/lib/api/endpoints/account";
import { DEFAULT_FILTERS } from "@/lib/activity/filters";
import { renderWithProviders } from "@/test/render";
import { PaymentsFeed } from "./PaymentsFeed";

const ME = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const OTHER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const pay = (id: string, partial: Partial<PaymentHistoryItem> = {}): PaymentHistoryItem => ({
  id,
  type: "payment",
  transactionHash: id.padEnd(64, "0"),
  createdAt: "2026-03-01T10:00:00Z",
  from: OTHER,
  to: ME,
  amount: "5",
  assetType: "native",
  flags: [],
  ...partial,
});

beforeEach(() => vi.restoreAllMocks());

describe("PaymentsFeed", () => {
  it("lists payments, then loads the next page", async () => {
    vi.spyOn(api.account, "payments")
      .mockResolvedValueOnce({ items: [pay("a1")], nextCursor: "c1", hasMore: true })
      .mockResolvedValueOnce({ items: [pay("b2", { from: ME, to: OTHER })], nextCursor: null, hasMore: false });
    renderWithProviders(<PaymentsFeed account={ME} filters={DEFAULT_FILTERS} onFiltersChange={vi.fn()} />);

    const list = await screen.findByRole("list", { name: "Payments" });
    expect(within(list).getByText("Received")).toBeInTheDocument();
    expect(within(list).getByRole("link")).toHaveAttribute("href", `/activity/${"a1".padEnd(64, "0")}`);

    await userEvent.setup().click(screen.getByRole("button", { name: "Load more" }));
    expect(await within(list).findByText("Sent")).toBeInTheDocument();
    expect(screen.getByText(/beginning of your history/)).toBeInTheDocument();
  });

  it("applies the filters to loaded items", async () => {
    vi.spyOn(api.account, "payments").mockResolvedValue({
      items: [pay("a1"), pay("b2", { from: ME, to: OTHER })],
      nextCursor: null,
      hasMore: false,
    });
    renderWithProviders(<PaymentsFeed account={ME} filters={{ ...DEFAULT_FILTERS, direction: "out" }} onFiltersChange={vi.fn()} />);
    const list = await screen.findByRole("list", { name: "Filtered payments" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText("Sent")).toBeInTheDocument();
  });

  it("shows empty and error states", async () => {
    vi.spyOn(api.account, "payments").mockResolvedValueOnce({ items: [], nextCursor: null, hasMore: false });
    const { unmount } = renderWithProviders(<PaymentsFeed account={ME} filters={DEFAULT_FILTERS} onFiltersChange={vi.fn()} />);
    expect(await screen.findByText("No payments yet")).toBeInTheDocument();
    unmount();

    vi.spyOn(api.account, "payments").mockRejectedValueOnce(new ApiError("boom", { status: 500, code: "INTERNAL_ERROR" }));
    renderWithProviders(<PaymentsFeed account={ME} filters={DEFAULT_FILTERS} onFiltersChange={vi.fn()} />);
    expect(await screen.findByText("Couldn't load your activity")).toBeInTheDocument();
  });
});
