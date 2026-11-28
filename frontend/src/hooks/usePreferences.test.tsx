import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/query/keys";
import { testQueryClient } from "@/test/render";
import { usePreferences, useUpdatePreferences } from "./usePreferences";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G }) }));

beforeEach(() => vi.restoreAllMocks());

function setup() {
  const queryClient = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("preferences hooks", () => {
  it("loads the account's preferences", async () => {
    vi.spyOn(api.preferences, "get").mockResolvedValue({ currency: "EUR" });
    const { wrapper } = setup();
    const { result } = renderHook(() => usePreferences(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ currency: "EUR" }));
  });

  it("stores the server's merged result after an update", async () => {
    vi.spyOn(api.preferences, "update").mockResolvedValue({ currency: "EUR", language: "en" });
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(queryKeys.preferences.all(G), { language: "en" });
    const { result } = renderHook(() => useUpdatePreferences(), { wrapper });
    await act(() => result.current.mutateAsync({ currency: "EUR" }));
    expect(queryClient.getQueryData(queryKeys.preferences.all(G))).toEqual({ currency: "EUR", language: "en" });
  });

  it("rolls back the optimistic change when the server rejects it", async () => {
    vi.spyOn(api.preferences, "get").mockResolvedValue({ currency: "USD" });
    vi.spyOn(api.preferences, "update").mockRejectedValue(
      new ApiError("bad", { status: 400, code: "VALIDATION_ERROR" })
    );
    const { queryClient, wrapper } = setup();
    // Observe the query as the settings page does, so the cache entry stays alive (gcTime is 0 in tests).
    const { result } = renderHook(() => ({ prefs: usePreferences(), update: useUpdatePreferences() }), { wrapper });
    await waitFor(() => expect(result.current.prefs.data).toEqual({ currency: "USD" }));

    await act(async () => {
      await result.current.update.mutateAsync({ currency: "EUR" }).catch(() => undefined);
    });
    expect(queryClient.getQueryData(queryKeys.preferences.all(G))).toEqual({ currency: "USD" });
    expect(result.current.prefs.data).toEqual({ currency: "USD" });
  });

  it("refetches instead of keeping the rejected change when there was nothing cached", async () => {
    vi.spyOn(api.preferences, "get").mockResolvedValue({ currency: "USD" });
    vi.spyOn(api.preferences, "update").mockRejectedValue(
      new ApiError("bad", { status: 400, code: "VALIDATION_ERROR" })
    );
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useUpdatePreferences(), { wrapper });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await result.current.mutateAsync({ currency: "EUR" }).catch(() => undefined);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.preferences.all(G) });
  });
});
