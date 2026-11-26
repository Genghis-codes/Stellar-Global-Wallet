import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query/keys";
import { testQueryClient } from "@/test/render";
import { useEmailStatus, useVerifyEmail } from "./useEmail";

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

describe("email hooks", () => {
  it("loads the email status", async () => {
    vi.spyOn(api.email, "get").mockResolvedValue({ email: null, verified: false });
    const { wrapper } = setup();
    const { result } = renderHook(() => useEmailStatus(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ email: null, verified: false }));
  });

  it("marks the email verified after confirming a token", async () => {
    vi.spyOn(api.email, "verify").mockResolvedValue({ message: "ok", email: "a@b.co" });
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useVerifyEmail(), { wrapper });
    await act(() => result.current.mutateAsync("tok"));
    expect(api.email.verify).toHaveBeenCalledWith("tok");
    expect(queryClient.getQueryData(queryKeys.email.all(G))).toEqual({ email: "a@b.co", verified: true });
  });
});
