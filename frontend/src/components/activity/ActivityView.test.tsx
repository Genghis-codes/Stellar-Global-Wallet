import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { renderWithProviders } from "@/test/render";
import { ActivityView } from "./ActivityView";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const replace = vi.fn();
let search = "";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/activity",
  useSearchParams: () => new URLSearchParams(search),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  replace.mockReset();
  search = "";
  vi.spyOn(api.account, "payments").mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
});

describe("ActivityView", () => {
  it("reads filters from the URL", async () => {
    search = "direction=in";
    renderWithProviders(<ActivityView />);
    expect(await screen.findByLabelText("Direction")).toHaveValue("in");
  });

  it("writes filter changes back to the URL", async () => {
    vi.spyOn(api.account, "payments").mockResolvedValue({
      items: [{ id: "1", type: "payment", transactionHash: "a".repeat(64), createdAt: "2026-01-01T00:00:00Z", flags: [] }],
      nextCursor: null,
      hasMore: false,
    });
    renderWithProviders(<ActivityView />);
    await userEvent.setup().selectOptions(await screen.findByLabelText("Type"), "payment");
    expect(replace).toHaveBeenCalledWith("/activity?type=payment", { scroll: false });
  });
});

describe("ActivityView tabs", () => {
  it("opens the transactions tab from ?tab= and switches back", async () => {
    search = "tab=transactions";
    vi.spyOn(api.account, "transactions").mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    renderWithProviders(<ActivityView />);
    expect(await screen.findByText("No transactions yet")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("tab", { name: "Payments" }));
    expect(replace).toHaveBeenCalledWith("/activity", { scroll: false });
  });
});
