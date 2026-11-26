import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, screen } from "@testing-library/react";
import { ToastProvider, useToast, type ToastApi } from "./Toast";

let api: ToastApi;

function setup() {
  const { result } = renderHook(() => useToast(), { wrapper: ToastProvider });
  api = result.current;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Toast", () => {
  it("shows a toast and auto-dismisses it", () => {
    vi.useFakeTimers();
    setup();
    act(() => {
      api.show({ title: "Copied", duration: 1000 });
    });
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("uses role=alert for danger toasts and keeps duration 0 toasts", () => {
    vi.useFakeTimers();
    setup();
    act(() => {
      api.show({ title: "Session expired", tone: "danger", duration: 0 });
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Session expired");
  });

  it("replaces a toast that reuses an id and dismisses on demand", () => {
    setup();
    act(() => {
      api.show({ id: "net", title: "Offline", duration: 0 });
      api.show({ id: "net", title: "Back online", duration: 0 });
    });
    expect(screen.queryByText("Offline")).toBeNull();
    expect(screen.getByText("Back online")).toBeInTheDocument();
    act(() => api.dismiss("net"));
    expect(screen.queryByText("Back online")).toBeNull();
  });

  it("throws outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useToast())).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
