import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { api } from "@/lib/api";
import type { ClaimableBalance } from "@/lib/api/endpoints/account";
import { renderWithProviders } from "@/test/render";
import { ClaimableView } from "./ClaimableView";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const OTHER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const signTransaction = vi.fn(async (xdr: string, _opts?: unknown) => `signed:${xdr}`);
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction } }) }));

const cb = (partial: Partial<ClaimableBalance>): ClaimableBalance => ({
  id: "a".repeat(72),
  asset: `USDC:${OTHER}`,
  amount: "15.0000000",
  sponsor: OTHER,
  lastModifiedLedger: 1,
  claimants: [{ destination: G, predicate: {} }],
  claimableNow: true,
  ...partial,
});

beforeEach(() => vi.restoreAllMocks());

describe("ClaimableView", () => {
  it("lists balances with their state and sender", async () => {
    vi.spyOn(api.account, "claimableBalances").mockResolvedValue({
      items: [cb({}), cb({ id: "b".repeat(72), claimableNow: false, claimableAfter: "2999-01-01T00:00:00Z", sponsor: G })],
      nextCursor: null,
      hasMore: false,
    });
    renderWithProviders(<ClaimableView />);
    const items = within(await screen.findByRole("list", { name: "Claimable balances" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("15.00USDC");
    expect(items[0]).toHaveTextContent("Claimable now");
    expect(items[0]).toHaveTextContent("GA5Z…KZVN");
    expect(items[1]).toHaveTextContent("Not yet claimable");
    expect(items[1]).toHaveTextContent("Sent by you");
  });

  it("shows an empty state", async () => {
    vi.spyOn(api.account, "claimableBalances").mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    renderWithProviders(<ClaimableView />);
    expect(await screen.findByText("Nothing to claim")).toBeInTheDocument();
  });
});
