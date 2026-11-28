import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetOption } from "@/components/send/AssetPicker";
import { api } from "@/lib/api";
import { NATIVE } from "@/lib/stellar/asset";
import { renderWithProviders } from "@/test/render";
import { PaymentRequestForm } from "./PaymentRequestForm";
import { paymentRequestLink } from "./PaymentRequestResult";

// user-event flows are slow on loaded CI machines; the default 5 s is too tight.
vi.setConfig({ testTimeout: 20_000 });

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const ISSUER = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";
const assets: AssetOption[] = [
  { id: "XLM", asset: NATIVE, balance: "10", spendable: "9" },
  { id: `USDC:${ISSUER}`, asset: { code: "USDC", issuer: ISSUER }, balance: "5", spendable: "5" },
];

afterEach(() => vi.restoreAllMocks());

describe("PaymentRequestForm", () => {
  it("creates a request for an issued asset with an id memo and shows the link", async () => {
    const uri = `web+stellar:pay?destination=${G}&amount=25`;
    const create = vi.spyOn(api.wallet, "createPaymentRequest").mockResolvedValue({ uri });
    renderWithProviders(<PaymentRequestForm account={G} assets={assets} />);

    await userEvent.selectOptions(screen.getByLabelText("Asset to receive"), `USDC:${ISSUER}`);
    await userEvent.type(screen.getByLabelText("Amount (optional)"), "25");
    await userEvent.selectOptions(screen.getByLabelText("Memo type"), "id");
    await userEvent.type(screen.getByLabelText("Memo (optional)"), "991");
    await userEvent.click(screen.getByRole("button", { name: "Create request" }));

    expect(create).toHaveBeenCalledWith(G, {
      destination: G,
      amount: "25",
      asset_code: "USDC",
      asset_issuer: ISSUER,
      memo: "991",
      memo_type: "MEMO_ID",
    });
    expect(await screen.findByRole("img", { name: "Payment request QR code" }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText(uri)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /\/pay\?uri=/ })).toHaveAttribute("href", paymentRequestLink(uri));
  });

  it("validates the memo against its type before calling the API", async () => {
    const create = vi.spyOn(api.wallet, "createPaymentRequest");
    renderWithProviders(<PaymentRequestForm account={G} assets={assets} />);

    await userEvent.selectOptions(screen.getByLabelText("Memo type"), "hash");
    await userEvent.type(screen.getByLabelText("Memo (optional)"), "abc");
    await userEvent.click(screen.getByRole("button", { name: "Create request" }));

    expect(screen.getByText(/64 hexadecimal characters/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("paymentRequestLink", () => {
  it("encodes the SEP-7 URI into the /pay landing page", () => {
    expect(paymentRequestLink("web+stellar:pay?destination=G&amount=1", "https://app.test")).toBe(
      "https://app.test/pay?uri=web%2Bstellar%3Apay%3Fdestination%3DG%26amount%3D1",
    );
  });
});
