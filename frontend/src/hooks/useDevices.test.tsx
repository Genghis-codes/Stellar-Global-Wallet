import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import type { Device } from "@/lib/api/endpoints/devices";
import { queryKeys } from "@/lib/query/keys";
import { testQueryClient } from "@/test/render";
import { useDevices, useRevokeDevice } from "./useDevices";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G }) }));

const device = (id: string): Device => ({
  id,
  account: G,
  platform: "expo",
  token: `ExponentPushToken[${id}]`,
  locale: "en",
  created_at: "2026-01-01T00:00:00.000Z",
  last_seen_at: "2026-01-01T00:00:00.000Z",
  expires_at: null,
});

beforeEach(() => vi.restoreAllMocks());

describe("device hooks", () => {
  it("lists devices and drops a revoked one from the cache", async () => {
    const queryClient = testQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    vi.spyOn(api.devices, "list").mockResolvedValueOnce([device("1"), device("2")]).mockResolvedValue([device("2")]);
    vi.spyOn(api.devices, "remove").mockResolvedValue({ message: "Device removed" });

    const { result } = renderHook(() => ({ list: useDevices(), revoke: useRevokeDevice() }), { wrapper });
    await waitFor(() => expect(result.current.list.data).toHaveLength(2));
    await act(() => result.current.revoke.mutateAsync("1"));
    expect(api.devices.remove).toHaveBeenCalledWith("1");
    expect(queryClient.getQueryData<Device[]>(queryKeys.devices.all(G))?.map((d) => d.id)).toEqual(["2"]);
  });
});
