import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import type { MultisigInfo } from "@/lib/api/endpoints/account";
import { renderWithProviders } from "@/test/render";
import { SignersView } from "./SignersView";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G }) }));

const multisigInfo: MultisigInfo = {
  account: G,
  signers: [
    { key: G, weight: 1, type: "ed25519_public_key", isMaster: true },
    { key: B, weight: 2, type: "ed25519_public_key", isMaster: false },
  ],
  thresholds: { low: 1, medium: 2, high: 3 },
  totalWeight: 3,
  reachable: { low: true, medium: true, high: true },
  isMultisig: true,
};

beforeEach(() => vi.restoreAllMocks());

describe("SignersView", () => {
  it("lists signers by weight and shows thresholds", async () => {
    vi.spyOn(api.account, "signers").mockResolvedValue(multisigInfo);
    renderWithProviders(<SignersView />);
    expect(await screen.findByText("Combined signer weight: 3")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Weight 2");
    expect(items[1]).toHaveTextContent("Master key");
    expect(items[1]).toHaveTextContent("You");
    expect(screen.getAllByText("Reachable")).toHaveLength(3);
  });

  it("shows a retryable error", async () => {
    vi.spyOn(api.account, "signers").mockRejectedValue(new ApiError("Horizon down", { status: 502, code: "HORIZON_UNAVAILABLE" }));
    renderWithProviders(<SignersView />);
    expect(await screen.findByText("Couldn't load signers")).toBeInTheDocument();
  });
});
