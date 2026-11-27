import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import type { HealthDetails } from "@/lib/api/endpoints/config";
import { ApiError } from "@/lib/api/errors";
import { testQueryClient } from "@/test/render";
import { useHealthDetails } from "./useServerConfig";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={testQueryClient()}>{children}</QueryClientProvider>;
}

const check = { ok: true, latencyMs: 12 };
const down: HealthDetails = {
  status: "down",
  checks: { horizon: { ok: false, latencyMs: 1500, error: "timeout" }, rpc: check, postgres: check, redis: check },
};

beforeEach(() => vi.restoreAllMocks());

describe("useHealthDetails", () => {
  it("returns the 503 body as a 'down' report", async () => {
    vi.spyOn(api.config, "healthDetails").mockRejectedValue(
      new ApiError("Service Unavailable", { status: 503, code: "HTTP_503", details: down })
    );
    const { result } = renderHook(() => useHealthDetails(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(down));
  });

  it("keeps other failures as errors", async () => {
    vi.spyOn(api.config, "healthDetails").mockRejectedValue(
      new ApiError("offline", { status: 0, code: "NETWORK_ERROR" })
    );
    const { result } = renderHook(() => useHealthDetails(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
