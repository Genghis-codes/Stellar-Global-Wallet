import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import type { PendingTx } from "@/lib/api/endpoints/pendingTxs";
import { queryKeys } from "@/lib/query/keys";
import { testQueryClient } from "@/test/render";
import { useAddSignatures, useCancelPendingTx, usePendingTxs } from "./usePendingTxs";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

const tx: PendingTx = {
  id: "tx-1",
  account: G,
  xdr: "AAAA",
  requiredWeight: 2,
  collectedSigners: [G],
  createdBy: G,
  expiresAt: null,
  status: "pending",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  hash: "ab".repeat(32),
  collectedWeight: 1,
};

beforeEach(() => vi.restoreAllMocks());

describe("pending-tx hooks", () => {
  it("lists, signs and caches the updated row", async () => {
    const queryClient = testQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const list = vi.spyOn(api.pendingTxs, "list").mockResolvedValue([tx]);
    const ready = { ...tx, status: "ready" as const, collectedWeight: 2 };
    vi.spyOn(api.pendingTxs, "addSignatures").mockResolvedValue(ready);

    const { result } = renderHook(() => ({ list: usePendingTxs(G), sign: useAddSignatures(G) }), { wrapper });
    await waitFor(() => expect(result.current.list.data).toHaveLength(1));
    await act(() => result.current.sign.mutateAsync({ id: "tx-1", xdr: "SIGNED" }));
    expect(api.pendingTxs.addSignatures).toHaveBeenCalledWith("tx-1", "SIGNED");
    expect(queryClient.getQueryData(queryKeys.pendingTxs.detail(G, "tx-1"))).toEqual(ready);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("cancels", async () => {
    const queryClient = testQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    vi.spyOn(api.pendingTxs, "cancel").mockResolvedValue({ ...tx, status: "cancelled" });
    const { result } = renderHook(() => useCancelPendingTx(G), { wrapper });
    await act(() => result.current.mutateAsync("tx-1"));
    expect(queryClient.getQueryData<PendingTx>(queryKeys.pendingTxs.detail(G, "tx-1"))?.status).toBe("cancelled");
  });
});
