import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import type { MultisigInfo } from "@/lib/api/endpoints/account";
import { renderWithProviders } from "@/test/render";
import { SignersView } from "./SignersView";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const C = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";
const signTransaction = vi.fn(async (xdr: string, _opts?: unknown) => `signed:${xdr}`);
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction } }) }));

function info(thresholds: MultisigInfo["thresholds"]): MultisigInfo {
  return {
    account: G,
    signers: [
      { key: G, weight: 2, type: "ed25519_public_key", isMaster: true },
      { key: B, weight: 1, type: "ed25519_public_key", isMaster: false },
      { key: C, weight: 1, type: "ed25519_public_key", isMaster: false },
    ],
    thresholds,
    totalWeight: 4,
    reachable: { low: true, medium: true, high: true },
    isMultisig: true,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api.pendingTxs, "list").mockResolvedValue([]);
});

/**
 * Wait for the signer list with a cheap text query first: polling a
 * role+name query over the whole page can outlast findBy's 1 s default on
 * the first test of the file, while the list is in fact rendered.
 */
async function signerButton(key: string) {
  await screen.findByText("Combined signer weight: 4", undefined, { timeout: 5000 });
  return screen.getByRole("button", { name: `Remove signer ${key}` });
}

describe("removing a signer", () => {
  it("disables removals that would lock the account out", async () => {
    vi.spyOn(api.account, "signers").mockResolvedValue(info({ low: 1, medium: 4, high: 4 }));
    renderWithProviders(<SignersView />);
    const remove = await signerButton(B);
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute("title", expect.stringMatching(/medium threshold \(4\)/));
    expect(screen.queryByRole("button", { name: `Remove signer ${G}` })).not.toBeInTheDocument();
  });

  it("removes a spare signer after confirmation", async () => {
    vi.spyOn(api.account, "signers").mockResolvedValue(info({ low: 1, medium: 1, high: 2 }));
    const build = vi.spyOn(api.multisig, "buildSetOptions").mockResolvedValue({
      xdr: "TX",
      networkPassphrase: "Test SDF Network ; September 2015",
      warnings: [],
      resultingSigners: [],
      resultingThresholds: { low: 1, medium: 1, high: 2 },
    });
    const submit = vi.spyOn(api.multisig, "submit").mockResolvedValue({ hash: "h", successful: true });
    renderWithProviders(<SignersView />);
    const user = userEvent.setup();
    await user.click(await signerButton(C));
    expect(screen.getByRole("dialog")).toHaveTextContent("Combined weight would drop to 3");
    await user.click(screen.getByLabelText("I understand the risks"));
    await user.click(screen.getByRole("button", { name: "Remove signer" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith("signed:TX"));
    expect(build).toHaveBeenCalledWith({ sourcePublicKey: G, removeSigners: [C] });
  });
});
