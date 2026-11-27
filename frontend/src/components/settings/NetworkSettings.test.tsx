import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { api } from "@/lib/api";
import type { HealthDetails } from "@/lib/api/endpoints/config";
import { ApiError } from "@/lib/api/errors";
import { renderWithProviders } from "@/test/render";
import { NetworkSettings } from "./NetworkSettings";

const info = {
  network: "testnet",
  networkPassphrase: "Test SDF Network ; September 2015",
  sorobanNetworkPassphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
};

const ok = { ok: true, latencyMs: 40 };
const degraded: HealthDetails = {
  status: "degraded",
  checks: {
    horizon: ok,
    rpc: ok,
    postgres: { ok: false, latencyMs: 900, error: "x" },
    redis: { ...ok, skipped: true },
  },
};

beforeEach(() => vi.restoreAllMocks());

describe("NetworkSettings", () => {
  it("shows network details and dependency health", async () => {
    vi.spyOn(api.config, "networkInfo").mockResolvedValue(info);
    vi.spyOn(api.config, "healthDetails").mockResolvedValue(degraded);
    renderWithProviders(<NetworkSettings />);

    expect(await screen.findByText("Test SDF Network ; September 2015")).toBeInTheDocument();
    expect(screen.getByText("https://horizon-testnet.stellar.org")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();

    expect(await screen.findByText("Degraded")).toBeInTheDocument();
    const checks = within(screen.getByRole("list", { name: "Dependency checks" })).getAllByRole("listitem");
    expect(checks[2]).toHaveTextContent("Database900 msFailing");
    expect(checks[3]).toHaveTextContent("Not configured");
  });

  it("warns when the server is on a different network and reports unreachable health", async () => {
    vi.spyOn(api.config, "networkInfo").mockResolvedValue({ ...info, network: "mainnet" });
    vi.spyOn(api.config, "healthDetails").mockRejectedValue(
      new ApiError("offline", { status: 0, code: "NETWORK_ERROR" })
    );
    renderWithProviders(<NetworkSettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The server is on mainnet but this app is built for testnet."
    );
    expect(await screen.findByText(/Couldn't reach the server/)).toBeInTheDocument();
  });
});
