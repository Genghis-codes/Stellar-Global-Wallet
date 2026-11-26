import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AmountDisplay, defaultDecimalsFor } from "./AmountDisplay";

describe("AmountDisplay", () => {
  it("formats native amounts with up to 7 decimals and shows the asset", () => {
    const { container } = render(<AmountDisplay amount="10000.1234567" asset="XLM" />);
    expect(container).toHaveTextContent("10,000.1234567XLM");
  });

  it("uses 2 fixed decimals for stablecoins", () => {
    const { container } = render(<AmountDisplay amount="5.5000000" asset="USDC" />);
    expect(container).toHaveTextContent("5.50USDC");
    expect(defaultDecimalsFor("usdc")).toBe(2);
    expect(defaultDecimalsFor("XLM")).toBe(7);
  });

  it("adds a plus sign for signed positive values only", () => {
    const { container, rerender } = render(<AmountDisplay amount="3" signed />);
    expect(container).toHaveTextContent("+3");
    rerender(<AmountDisplay amount="-3" signed />);
    expect(container).toHaveTextContent("-3");
    expect(container).not.toHaveTextContent("+");
  });
});
