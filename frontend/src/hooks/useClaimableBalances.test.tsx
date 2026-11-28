import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import type { ClaimableBalance } from "@/lib/api/endpoints/account";
import { testQueryClient } from "@/test/render";
import { canReclaim, claimableState, pendingClaimables, useClaimableBalances } from "./useClaimableBalances";

const ME = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const OTHER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const cb = (partial: Partial<ClaimableBalance>): ClaimableBalance => ({
  id: "0".repeat(72),
  asset: "native",
  amount: "10",
  sponsor: OTHER,
  lastModifiedLedger: 1,
  claimants: [{ destination: ME, predicate: { unconditional: true } }],
  claimableNow: true,
  ...partial,
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={testQueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.restoreAllMocks());

describe("useClaimableBalances", () => {
  it("unwraps the first page", async () => {
    const list = vi.spyOn(api.account, "claimableBalances").mockResolvedValue({ items: [cb({})], nextCursor: null, hasMore: false });
    const { result } = renderHook(() => useClaimableBalances(ME), { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(list).toHaveBeenCalledWith(ME, { limit: 100 }, expect.anything());
  });
});

describe("claimable helpers", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  it("classifies balances", () => {
    expect(claimableState(cb({}), now)).toBe("claimable");
    expect(claimableState(cb({ claimableNow: false, claimableAfter: "2026-07-01T00:00:00Z" }), now)).toBe("upcoming");
    expect(claimableState(cb({ claimableNow: false, claimableBefore: "2026-05-01T00:00:00Z" }), now)).toBe("expired");
  });

  it("allows reclaiming only balances the account sponsored and can claim back", () => {
    expect(canReclaim(cb({ sponsor: ME }), ME)).toBe(true);
    expect(canReclaim(cb({}), ME)).toBe(false);
  });

  it("counts balances waiting to be claimed", () => {
    expect(pendingClaimables([cb({}), cb({ claimableNow: false }), cb({ sponsor: ME })], ME)).toHaveLength(1);
  });
});
