import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { api } from "@/lib/api";
import type { AppConfigResponse } from "@/lib/api/endpoints/config";
import { renderWithProviders } from "@/test/render";
import { SmartWalletView } from "./SmartWalletView";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G }) }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api.config, "get").mockResolvedValue({
    contracts: { globeWallet: { contractId: CONTRACT, pendingUpgrade: null }, tokenWrapper: null },
    features: { contract: true },
  } as unknown as AppConfigResponse);
  vi.spyOn(api.contract, "admin").mockResolvedValue({ admin: G, pendingAdmin: null });
});

describe("SmartWalletView", () => {
  it("shows the contract state and links to each section", async () => {
    vi.spyOn(api.contract, "status").mockResolvedValue({ sendsPaused: true, pauser: G });
    vi.spyOn(api.contract, "recovery").mockResolvedValue({
      guardians: [],
      guardianCount: 0,
      config: null,
      configured: false,
      proposal: null,
    });
    renderWithProviders(<SmartWalletView />);
    expect(await screen.findByText("Paused")).toBeInTheDocument();
    expect(await screen.findByText("You")).toBeInTheDocument();
    for (const name of ["Spend limits", "Allowances", "Guardians", "Recovery"]) {
      expect(screen.getByRole("link", { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(screen.queryByText(/recovery is in progress/)).not.toBeInTheDocument();
  });
});
