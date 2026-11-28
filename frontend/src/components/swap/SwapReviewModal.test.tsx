import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import type { PathPaymentBuild, PaymentPath } from "@/lib/api/endpoints/wallet";
import { Networks } from "@stellar/stellar-sdk";
import { WalletError } from "@/lib/wallet/types";
import { renderWithProviders } from "@/test/render";
import type { SwapDraft } from "./SwapForm";
import { SwapReviewModal } from "./SwapReviewModal";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const signTransaction = vi.fn();

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction } }) }));

const quote: PaymentPath = {
  source_asset_type: "native",
  source_amount: "10",
  destination_asset_type: "credit_alphanum4",
  destination_asset_code: "USDC",
  destination_asset_issuer: ISSUER,
  destination_amount: "1.2",
  path: [{ asset_type: "credit_alphanum4", asset_code: "AQUA", asset_issuer: ISSUER }],
};

const draft: SwapDraft = {
  mode: "send",
  from: { id: "XLM", asset: { code: "XLM" }, balance: "100", spendable: "98" },
  to: { id: `USDC:${ISSUER}`, asset: { code: "USDC", issuer: ISSUER }, balance: "0", spendable: "0" },
  amount: "10",
  slippageBps: 50,
  quote,
};

const build = { xdr: "UNSIGNED", networkPassphrase: Networks.TESTNET } as PathPaymentBuild;

afterEach(() => {
  vi.restoreAllMocks();
  signTransaction.mockReset();
});

describe("SwapReviewModal", () => {
  it("shows the bounds, builds a self path payment, signs and submits", async () => {
    const buildSpy = vi.spyOn(api.wallet, "buildStrictSend").mockResolvedValue(build);
    const submit = vi.spyOn(api.wallet, "submit").mockResolvedValue({ hash: "abcdef1234567890", successful: true });
    signTransaction.mockResolvedValue("SIGNED");
    const onDone = vi.fn();
    renderWithProviders(<SwapReviewModal draft={draft} onClose={() => {}} onDone={onDone} />);

    expect(screen.getByText("10 XLM")).toBeInTheDocument();
    expect(screen.getByText("1.194 USDC")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Confirm swap" }));

    expect(await screen.findByText("Swap complete")).toBeInTheDocument();
    expect(buildSpy).toHaveBeenCalledWith({
      sourcePublicKey: G,
      destinationPublicKey: G,
      sendAsset: "XLM",
      destAsset: `USDC:${ISSUER}`,
      path: [`AQUA:${ISSUER}`],
      slippageBps: 50,
      sendAmount: "10",
      quotedDestAmount: "1.2",
    });
    expect(signTransaction).toHaveBeenCalledWith("UNSIGNED", { networkPassphrase: Networks.TESTNET, address: G });
    expect(submit).toHaveBeenCalledWith("SIGNED", expect.objectContaining({ account: G }));
    expect(onDone).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /abcdef123456/ })).toHaveAttribute("href", expect.stringContaining("/tx/abcdef1234567890"));
  });

  it("uses strict-receive for exact-output swaps", async () => {
    const buildSpy = vi.spyOn(api.wallet, "buildStrictReceive").mockResolvedValue(build);
    vi.spyOn(api.wallet, "submit").mockResolvedValue({ hash: "h", status: "pending" });
    signTransaction.mockResolvedValue("SIGNED");
    renderWithProviders(
      <SwapReviewModal draft={{ ...draft, mode: "receive", amount: "1.2" }} onClose={() => {}} onDone={() => {}} />,
    );
    expect(screen.getByText("10.05 XLM")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Confirm swap" }));
    expect(await screen.findByText("Swap submitted")).toBeInTheDocument();
    expect(buildSpy).toHaveBeenCalledWith(expect.objectContaining({ destAmount: "1.2", quotedSendAmount: "10" }));
  });

  it("stays quiet when the user rejects in the wallet", async () => {
    vi.spyOn(api.wallet, "buildStrictSend").mockResolvedValue(build);
    const submit = vi.spyOn(api.wallet, "submit");
    signTransaction.mockRejectedValue(new WalletError("USER_REJECTED", "Rejected"));
    renderWithProviders(<SwapReviewModal draft={draft} onClose={() => {}} onDone={() => {}} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Confirm swap" }));
    expect(await screen.findByRole("button", { name: "Confirm swap" })).toBeEnabled();
    expect(submit).not.toHaveBeenCalled();
    expect(screen.queryByText("Swap failed")).toBeNull();
  });
});
