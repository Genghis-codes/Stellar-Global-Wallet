import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { api } from "@/lib/api";
import type { PendingTx } from "@/lib/api/endpoints/pendingTxs";
import { renderWithProviders } from "@/test/render";
import { PendingTxsView } from "./PendingTxsView";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G }) }));

const tx = (overrides: Partial<PendingTx>): PendingTx => ({
  id: "tx-1",
  account: G,
  xdr: "AAAA",
  requiredWeight: 2,
  collectedSigners: [B],
  createdBy: B,
  expiresAt: null,
  status: "pending",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  hash: "ab".repeat(32),
  collectedWeight: 1,
  ...overrides,
});

beforeEach(() => vi.restoreAllMocks());

describe("PendingTxsView", () => {
  it("lists open transactions first with status and progress", async () => {
    vi.spyOn(api.pendingTxs, "list").mockResolvedValue([
      tx({ id: "old", status: "submitted", createdAt: "2026-11-05T00:00:00.000Z", hash: "cd".repeat(32) }),
      tx({ id: "open" }),
    ]);
    renderWithProviders(<PendingTxsView />);
    const items = await screen.findAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Awaiting signatures");
    expect(items[0]).toHaveTextContent("Weight 1 of 2");
    expect(within(items[0]!).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    expect(items[1]).toHaveTextContent("Submitted");
  });

  it("shows an empty state", async () => {
    vi.spyOn(api.pendingTxs, "list").mockResolvedValue([]);
    renderWithProviders(<PendingTxsView />);
    expect(await screen.findByText("Nothing to sign")).toBeInTheDocument();
  });
});
