import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { api } from "@/lib/api";
import type { AppConfigResponse, FeatureFlags } from "@/lib/api/endpoints/config";
import { renderWithProviders } from "@/test/render";
import { FeatureGate } from "./FeatureGate";

const flags: FeatureFlags = { multisig: true, feeBump: true, pathPayments: true, recovery: false, priceOracle: false };

function config(contract: boolean) {
  return { features: { contract } } as AppConfigResponse;
}

beforeEach(() => vi.restoreAllMocks());

describe("FeatureGate", () => {
  it("renders children when every feature is on", async () => {
    vi.spyOn(api.config, "flags").mockResolvedValue(flags);
    vi.spyOn(api.config, "get").mockResolvedValue(config(true));
    renderWithProviders(
      <FeatureGate requires={["multisig", "contract"]} title="Signers">
        <p>secret page</p>
      </FeatureGate>,
    );
    expect(await screen.findByText("secret page")).toBeInTheDocument();
  });

  it("explains what is missing", async () => {
    vi.spyOn(api.config, "flags").mockResolvedValue(flags);
    vi.spyOn(api.config, "get").mockResolvedValue(config(false));
    renderWithProviders(
      <FeatureGate requires={["recovery", "contract"]} title="Recovery">
        <p>secret page</p>
      </FeatureGate>,
    );
    expect(await screen.findByText("Recovery isn't available")).toBeInTheDocument();
    expect(screen.getByText(/Social recovery isn't enabled.*No smart-wallet contract/)).toBeInTheDocument();
    expect(screen.queryByText("secret page")).not.toBeInTheDocument();
  });

  it("treats a failed flags request as off", async () => {
    vi.spyOn(api.config, "flags").mockRejectedValue(new Error("down"));
    renderWithProviders(
      <FeatureGate requires={["multisig"]} title="Signers">
        <p>secret page</p>
      </FeatureGate>,
    );
    expect(await screen.findByText("Signers isn't available")).toBeInTheDocument();
  });
});
