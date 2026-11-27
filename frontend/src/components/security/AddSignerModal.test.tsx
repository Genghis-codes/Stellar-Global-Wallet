import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import type { MultisigInfo } from "@/lib/api/endpoints/account";
import type { PendingTx } from "@/lib/api/endpoints/pendingTxs";
import { renderWithProviders } from "@/test/render";
import { AddSignerModal } from "./AddSignerModal";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const signTransaction = vi.fn(async (xdr: string, _opts?: unknown) => `signed:${xdr}`);
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction } }) }));

const solo: MultisigInfo = {
  account: G,
  signers: [{ key: G, weight: 1, type: "ed25519_public_key", isMaster: true }],
  thresholds: { low: 0, medium: 0, high: 0 },
  totalWeight: 1,
  reachable: { low: true, medium: true, high: true },
  isMultisig: false,
};

const built = {
  xdr: "TX",
  networkPassphrase: "Test SDF Network ; September 2015",
  warnings: [],
  resultingSigners: [],
  resultingThresholds: { low: 0, medium: 0, high: 0 },
};

beforeEach(() => {
  vi.restoreAllMocks();
  signTransaction.mockClear();
});

async function fill(key: string, weight: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Signer account"), key);
  const weightField = screen.getByLabelText("Weight");
  await user.clear(weightField);
  await user.type(weightField, weight);
  return user;
}

describe("AddSignerModal", () => {
  it("builds, signs and submits when the user can sign alone", async () => {
    const build = vi.spyOn(api.multisig, "buildSetOptions").mockResolvedValue(built);
    const submit = vi.spyOn(api.multisig, "submit").mockResolvedValue({ hash: "h", successful: true });
    const onClose = vi.fn();
    renderWithProviders(<AddSignerModal open onClose={onClose} info={solo} account={G} />);
    const user = await fill(B, "1");
    await user.click(screen.getByLabelText("I understand the risks"));
    await user.click(screen.getByRole("button", { name: "Add signer" }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith("signed:TX"));
    expect(build).toHaveBeenCalledWith({ sourcePublicKey: G, addSigners: [{ key: B, weight: 1 }] });
    expect(await screen.findByText("Signers updated")).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it("requires acknowledging risks before continuing", async () => {
    renderWithProviders(
      <AddSignerModal open onClose={vi.fn()} info={{ ...solo, thresholds: { low: 1, medium: 1, high: 1 } }} account={G} />,
    );
    const user = await fill(B, "1");
    const confirm = screen.getByRole("button", { name: "Add signer" });
    expect(screen.getByText("A single signer can still authorise high-threshold changes on its own.")).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    await user.click(screen.getByLabelText("I understand the risks"));
    expect(confirm).toBeEnabled();
  });

  it("validates the key and weight", async () => {
    renderWithProviders(<AddSignerModal open onClose={vi.fn()} info={solo} account={G} />);
    await fill("GBAD", "300");
    expect(screen.getByText("Enter a valid G… account id.")).toBeInTheDocument();
    expect(screen.getByText("Must be 255 or less.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add signer" })).toBeDisabled();
  });

  it("shares the change for co-signing when the user's weight is too low", async () => {
    const info: MultisigInfo = {
      ...solo,
      signers: [...solo.signers, { key: B, weight: 1, type: "ed25519_public_key", isMaster: false }],
      thresholds: { low: 1, medium: 2, high: 2 },
      totalWeight: 2,
      isMultisig: true,
    };
    vi.spyOn(api.multisig, "buildSetOptions").mockResolvedValue(built);
    const submit = vi.spyOn(api.multisig, "submit");
    const create = vi.spyOn(api.pendingTxs, "create").mockResolvedValue({ id: "p1" } as PendingTx);
    renderWithProviders(<AddSignerModal open onClose={vi.fn()} info={info} account={G} />);
    const user = await fill(B, "2");
    await user.click(screen.getByLabelText("I understand the risks"));
    await user.click(screen.getByRole("button", { name: "Update signer" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("signed:TX"));
    expect(submit).not.toHaveBeenCalled();
    expect(await screen.findByText("Shared for co-signing")).toBeInTheDocument();
  });
});
