import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import type { MultisigInfo } from "@/lib/api/endpoints/account";
import { renderWithProviders } from "@/test/render";
import { EditThresholdsModal } from "./EditThresholdsModal";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const signTransaction = vi.fn(async (xdr: string, _opts?: unknown) => `signed:${xdr}`);
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction } }) }));

const info: MultisigInfo = {
  account: G,
  signers: [
    { key: G, weight: 2, type: "ed25519_public_key", isMaster: true },
    { key: B, weight: 1, type: "ed25519_public_key", isMaster: false },
  ],
  thresholds: { low: 1, medium: 1, high: 2 },
  totalWeight: 3,
  reachable: { low: true, medium: true, high: true },
  isMultisig: true,
};

beforeEach(() => vi.restoreAllMocks());

async function setField(label: string, value: string) {
  const user = userEvent.setup();
  const field = screen.getByLabelText(label);
  await user.clear(field);
  await user.type(field, value);
  return user;
}

describe("EditThresholdsModal", () => {
  it("blocks thresholds above the combined weight", async () => {
    renderWithProviders(<EditThresholdsModal open onClose={vi.fn()} info={info} account={G} />);
    await setField("High threshold", "4");
    expect(screen.getByRole("alert")).toHaveTextContent("would lock the account out");
    expect(screen.getByRole("button", { name: "Save thresholds" })).toBeDisabled();
  });

  it("blocks zeroing the master key when nothing else can reach the threshold", async () => {
    renderWithProviders(<EditThresholdsModal open onClose={vi.fn()} info={info} account={G} />);
    await setField("Master key weight", "0");
    expect(screen.getByRole("alert")).toHaveTextContent("high threshold (2)");
  });

  it("sends only the changed fields", async () => {
    const build = vi.spyOn(api.multisig, "buildSetOptions").mockResolvedValue({
      xdr: "TX",
      networkPassphrase: "Test SDF Network ; September 2015",
      warnings: [],
      resultingSigners: [],
      resultingThresholds: { low: 1, medium: 2, high: 3 },
    });
    vi.spyOn(api.multisig, "submit").mockResolvedValue({ hash: "h", successful: true });
    renderWithProviders(<EditThresholdsModal open onClose={vi.fn()} info={info} account={G} />);
    await setField("Medium threshold", "2");
    const user = await setField("High threshold", "3");
    await user.click(screen.getByLabelText("I understand the risks"));
    await user.click(screen.getByRole("button", { name: "Save thresholds" }));
    await waitFor(() =>
      expect(build).toHaveBeenCalledWith({ sourcePublicKey: G, mediumThreshold: 2, highThreshold: 3 }),
    );
  });
});
