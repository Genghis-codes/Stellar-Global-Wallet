import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { testQueryClient } from "@/test/render";
import { useDebouncedValue } from "./useDebouncedValue";
import { useResolveAddress } from "./useResolveAddress";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={testQueryClient()}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useResolveAddress", () => {
  it("resolves federation addresses through the API", async () => {
    vi.spyOn(api.resolve, "resolve").mockResolvedValue({ type: "federation", accountId: G });
    const { result } = renderHook(() => useResolveAddress(" bob*example.com "), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ type: "federation", accountId: G }));
    expect(api.resolve.resolve).toHaveBeenCalledWith("bob*example.com", expect.anything());
  });

  it("does not call the API for plain accounts or invalid input", () => {
    const spy = vi.spyOn(api.resolve, "resolve");
    renderHook(() => useResolveAddress(G), { wrapper });
    renderHook(() => useResolveAddress("nonsense"), { wrapper });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("useDebouncedValue", () => {
  it("only updates after the value settles", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), { initialProps: { value: "a" } });
    rerender({ value: "ab" });
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe("ab");
  });
});
