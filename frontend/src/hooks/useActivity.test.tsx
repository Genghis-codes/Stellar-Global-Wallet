import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import { testQueryClient } from "@/test/render";
import { ACTIVITY_PAGE_SIZE, useActivityFeed, usePaymentsFeed } from "./useActivity";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={testQueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.restoreAllMocks());

describe("activity feeds", () => {
  it("pages the payments feed with the previous page's cursor", async () => {
    const payments = vi
      .spyOn(api.account, "payments")
      .mockResolvedValueOnce({ items: [], nextCursor: "c1", hasMore: true })
      .mockResolvedValueOnce({ items: [], nextCursor: null, hasMore: false });
    const { result } = renderHook(() => usePaymentsFeed(G), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(payments).toHaveBeenNthCalledWith(1, G, { cursor: undefined, limit: ACTIVITY_PAGE_SIZE }, expect.anything());
    expect(payments).toHaveBeenNthCalledWith(2, G, { cursor: "c1", limit: ACTIVITY_PAGE_SIZE }, expect.anything());
    expect(result.current.hasNextPage).toBe(false);
  });

  it("uses `next` for the unified activity cursor", async () => {
    vi.spyOn(api.account, "activity").mockResolvedValue({ items: [], next: "abc", hasMore: true });
    const { result } = renderHook(() => useActivityFeed(G), { wrapper });
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
  });

  it("stays idle without an account", () => {
    const spy = vi.spyOn(api.account, "payments");
    renderHook(() => usePaymentsFeed(undefined), { wrapper });
    expect(spy).not.toHaveBeenCalled();
  });
});
