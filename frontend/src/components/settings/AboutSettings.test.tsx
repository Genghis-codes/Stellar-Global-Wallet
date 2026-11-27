import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { api } from "@/lib/api";
import type { AppConfigResponse } from "@/lib/api/endpoints/config";
import { renderWithProviders } from "@/test/render";
import { AboutSettings } from "./AboutSettings";

const config: AppConfigResponse = {
  network: "testnet",
  networkPassphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  contracts: { globeWallet: { contractId: null, pendingUpgrade: null }, tokenWrapper: null },
  features: { contract: false },
  apiVersion: "1.4.0",
};

beforeEach(() => vi.restoreAllMocks());

describe("AboutSettings", () => {
  it("shows app and API versions", async () => {
    vi.spyOn(api.config, "get").mockResolvedValue(config);
    renderWithProviders(<AboutSettings />);
    expect(screen.getByText("App version").nextSibling).toHaveTextContent(/\d+\.\d+\.\d+/);
    expect(await screen.findByText("1.4.0")).toBeInTheDocument();
    expect(screen.getByText("Not deployed")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("warns when the server requires a newer app", async () => {
    vi.spyOn(api.config, "get").mockResolvedValue({ ...config, minClientVersion: "99.0.0" });
    renderWithProviders(<AboutSettings />);
    expect(await screen.findByRole("alert")).toHaveTextContent("older than the server supports (99.0.0)");
  });
});
