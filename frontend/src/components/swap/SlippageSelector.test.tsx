import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PaymentPath } from "@/lib/api/endpoints/wallet";
import { QuoteSummary } from "./QuoteSummary";
import { SlippageSelector } from "./SlippageSelector";

describe("SlippageSelector", () => {
  it("selects presets", async () => {
    const onChange = vi.fn();
    render(<SlippageSelector value={50} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "0.5%" })).toHaveAttribute("aria-checked", "true");
    await userEvent.setup().click(screen.getByRole("radio", { name: "1%" }));
    expect(onChange).toHaveBeenCalledWith(100);
  });

  it("accepts a custom value and rejects one above the cap", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SlippageSelector value={50} onChange={onChange} />);
    const input = screen.getByLabelText("Custom slippage percent");
    await user.type(input, "2");
    expect(onChange).toHaveBeenLastCalledWith(200);
    await user.clear(input);
    await user.type(input, "7");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/between 0 and 5%/)).toBeInTheDocument();
  });

  it("warns about high tolerances", () => {
    render(<SlippageSelector value={400} onChange={() => {}} />);
    expect(screen.getByText(/High tolerance/)).toBeInTheDocument();
  });
});

describe("QuoteSummary", () => {
  const quote: PaymentPath = {
    source_asset_type: "native",
    source_amount: "100",
    destination_asset_type: "credit_alphanum4",
    destination_asset_code: "USDC",
    destination_asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    destination_amount: "12",
    path: [{ asset_type: "credit_alphanum4", asset_code: "AQUA", asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" }],
  };

  it("shows rate, route and minimum received for exact-input swaps", () => {
    const { container } = render(<QuoteSummary quote={quote} mode="send" slippageBps={50} fromCode="XLM" toCode="USDC" />);
    expect(container).toHaveTextContent("1 XLM ≈ 0.12USDC");
    expect(container).toHaveTextContent("XLM → AQUA → USDC");
    expect(container).toHaveTextContent("Minimum received11.94USDC");
  });

  it("shows maximum spent for exact-output swaps", () => {
    const { container } = render(<QuoteSummary quote={quote} mode="receive" slippageBps={100} fromCode="XLM" toCode="USDC" />);
    expect(container).toHaveTextContent("Maximum spent101XLM");
    expect(container).toHaveTextContent("Slippage tolerance1%");
  });
});
