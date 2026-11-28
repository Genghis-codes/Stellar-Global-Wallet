import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { networkPassphrase } from "@/lib/stellar/network";
import { WalletError } from "@/lib/wallet/types";
import { renderWithProviders } from "@/test/render";
import { SendView } from "./SendView";

// Full multi-step flows: give them more than the default 5 s.
vi.setConfig({ testTimeout: 20_000 });

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const DEST = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";
const signTransaction = vi.fn();

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/stellar/feeBump", () => ({
  needsFeeBump: () => false,
  buildFeeBump: () => "BUMP",
  feePerOperation: () => 100n,
  feeBumpTotal: () => 2000n,
}));

const build = {
  xdr: "UNSIGNED",
  networkPassphrase: networkPassphrase(),
  fee: "100",
  sequence: "1",
  timeBounds: { minTime: "0", maxTime: "0" },
  expiresAt: null,
  operationType: "payment" as const,
};

beforeEach(() => {
  vi.spyOn(api.account, "reserves").mockResolvedValue({
    reserves: {
      baseReserve: "0.5",
      subentryCount: 0,
      numSponsoring: 0,
      numSponsored: 0,
      minimumBalance: "1",
      sellingLiabilities: "0",
      spendable: "99",
    },
    balances: [{ asset_type: "native", balance: "100", spendable: "99" }],
  });
  vi.spyOn(api.config, "fees").mockResolvedValue({
    low: { stroops: "100", xlm: "0.00001" },
    normal: { stroops: "100", xlm: "0.00001" },
    high: { stroops: "1000", xlm: "0.0001" },
    ledgerCapacityUsage: "0.1",
    source: "horizon",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  signTransaction.mockReset();
});

async function fillForm(amount = "10") {
  renderWithProviders(<SendView />);
  // Paste the long address: typing 56 characters one by one is slow on busy CI machines.
  await userEvent.click(await screen.findByLabelText("Recipient"));
  await userEvent.paste(DEST);
  await userEvent.type(screen.getByLabelText("Amount"), amount);
  await userEvent.type(screen.getByLabelText("Memo (optional)"), "rent");
}

describe("SendView", () => {
  it("validates before calling the backend", async () => {
    const precheck = vi.spyOn(api.wallet, "precheck");
    renderWithProviders(<SendView />);
    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    expect(screen.getByText("Enter a recipient.")).toBeInTheDocument();
    expect(screen.getByText("Enter an amount.")).toBeInTheDocument();
    expect(precheck).not.toHaveBeenCalled();
  });

  it("caps the amount at the spendable balance minus the fee", async () => {
    await fillForm("99");
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByText("You can send at most 98.99999 XLM.")).toBeInTheDocument();
  });

  it("prechecks, builds, signs, submits and shows the result", async () => {
    const precheck = vi
      .spyOn(api.wallet, "precheck")
      .mockResolvedValue({ warnings: [], blocking: false, operationType: "payment", spendable: "99" });
    const buildSend = vi.spyOn(api.wallet, "buildSend").mockResolvedValue(build);
    const submit = vi.spyOn(api.wallet, "submit").mockResolvedValue({ hash: "f".repeat(64), ledger: 9, successful: true });
    signTransaction.mockResolvedValue("SIGNED");

    await fillForm();
    await userEvent.click(screen.getByRole("button", { name: "Review" }));

    expect(await screen.findByText("Review payment")).toBeInTheDocument();
    // Focus follows the step for keyboard and screen-reader users.
    expect(screen.getByRole("group", { name: "Review payment" })).toHaveFocus();
    expect(precheck).toHaveBeenCalledWith({ sourcePublicKey: G, destinationPublicKey: DEST, amount: "10", asset: "XLM", memo: "rent" });
    expect(buildSend).toHaveBeenCalledWith({ sourcePublicKey: G, destinationPublicKey: DEST, amount: "10", asset: "XLM", memo: "rent" });

    await userEvent.click(screen.getByRole("button", { name: "Sign and send" }));
    expect(await screen.findByText("Payment sent")).toBeInTheDocument();
    expect(signTransaction).toHaveBeenCalledWith("UNSIGNED", expect.objectContaining({ address: G }));
    expect(submit).toHaveBeenCalledWith("SIGNED", { account: G, idempotencyKey: expect.any(String) });
    expect(screen.getByRole("link", { name: /View on explorer/ })).toBeInTheDocument();
  });

  it("does not build when the precheck is blocking", async () => {
    vi.spyOn(api.wallet, "precheck").mockResolvedValue({
      warnings: [{ code: "DESTINATION_NOT_FUNDED", message: "Destination account does not exist.", blocking: true }],
      blocking: true,
      operationType: "payment",
      spendable: "99",
    });
    const buildSend = vi.spyOn(api.wallet, "buildSend");

    await fillForm("0.5");
    await userEvent.click(screen.getByRole("button", { name: "Review" }));

    expect(await screen.findByText("Destination account does not exist.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign and send" })).toBeDisabled();
    expect(buildSend).not.toHaveBeenCalled();
  });

  it("stays on the review step when the user declines in the wallet", async () => {
    vi.spyOn(api.wallet, "precheck").mockResolvedValue({ warnings: [], blocking: false, operationType: "payment", spendable: "99" });
    vi.spyOn(api.wallet, "buildSend").mockResolvedValue(build);
    const submit = vi.spyOn(api.wallet, "submit");
    signTransaction.mockRejectedValue(new WalletError("USER_REJECTED", "declined"));

    await fillForm();
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    await userEvent.click(await screen.findByRole("button", { name: "Sign and send" }));

    await waitFor(() => expect(signTransaction).toHaveBeenCalled());
    expect(screen.getByText("Review payment")).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it("offers to speed up a submission the network didn't confirm in time", async () => {
    vi.spyOn(api.config, "flags").mockResolvedValue({ multisig: true, feeBump: true, pathPayments: true, recovery: false, priceOracle: false });
    vi.spyOn(api.wallet, "precheck").mockResolvedValue({ warnings: [], blocking: false, operationType: "payment", spendable: "99" });
    vi.spyOn(api.wallet, "buildSend").mockResolvedValue(build);
    vi.spyOn(api.wallet, "submit").mockResolvedValue({ hash: "e".repeat(64), status: "pending" });
    const sponsor = vi.spyOn(api.wallet, "sponsorFee").mockResolvedValue({ hash: "d".repeat(64), successful: true });
    signTransaction.mockResolvedValue("SIGNED");

    await fillForm();
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    await userEvent.click(await screen.findByRole("button", { name: "Sign and send" }));

    expect(await screen.findByText("Waiting for the network")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Let GlobeWallet pay the fee" }));
    expect(sponsor).toHaveBeenCalledWith(G, "SIGNED");
    expect(await screen.findByText("Payment sent")).toBeInTheDocument();
  });
});
