import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import { renderWithProviders } from "@/test/render";
import { PayRequestView, sendHrefFor } from "./PayRequestView";

// user-event flows are slow on loaded CI machines; the default 5 s is too tight.
vi.setConfig({ testTimeout: 20_000 });

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const DEST = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G }) }));

afterEach(() => vi.restoreAllMocks());

describe("sendHrefFor", () => {
  it("maps SEP-7 fields to the send form's query", () => {
    expect(sendHrefFor({ destination: DEST, amount: "5", asset_code: "USDC", asset_issuer: G, memo: "hi" })).toBe(
      `/send?to=${DEST}&amount=5&asset=USDC%3A${G}&memo=hi`,
    );
    expect(sendHrefFor({ destination: DEST, asset_code: "XLM" })).toBe(`/send?to=${DEST}`);
  });
});

describe("PayRequestView", () => {
  it("shows the request and links to a pre-filled send form", async () => {
    const parse = vi
      .spyOn(api.wallet, "parsePaymentRequest")
      .mockResolvedValue({ fields: { destination: DEST, amount: "12", memo: "inv-7" }, warnings: [] });
    renderWithProviders(<PayRequestView uri="web+stellar:pay?destination=x" />);

    expect(await screen.findByText("inv-7", undefined, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue to send" })).toHaveAttribute(
      "href",
      `/send?to=${DEST}&amount=12&memo=inv-7`,
    );
    expect(parse).toHaveBeenCalledWith(G, "web+stellar:pay?destination=x");
  });

  it("blocks requests with warnings or memo types the send flow can't attach", async () => {
    vi.spyOn(api.wallet, "parsePaymentRequest").mockResolvedValue({
      fields: { destination: DEST, memo: "123", memo_type: "MEMO_ID" },
      warnings: ["asset_issuer is required for non-native assets"],
    });
    renderWithProviders(<PayRequestView uri="web+stellar:pay?destination=x" />);

    expect(await screen.findByText("asset_issuer is required for non-native assets", undefined, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText(/needs a memo ID/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to send" })).toBeDisabled();
  });

  it("explains invalid or missing requests", async () => {
    vi.spyOn(api.wallet, "parsePaymentRequest").mockRejectedValue(
      new ApiError("URI must start with web+stellar:pay?", { status: 400, code: "VALIDATION_ERROR" }),
    );
    const { unmount } = renderWithProviders(<PayRequestView uri="https://evil.test" />);
    expect(await screen.findByText("This payment request is invalid", undefined, { timeout: 10_000 })).toBeInTheDocument();
    unmount();

    renderWithProviders(<PayRequestView uri={null} />);
    expect(screen.getByText("No payment request")).toBeInTheDocument();
  });
});
