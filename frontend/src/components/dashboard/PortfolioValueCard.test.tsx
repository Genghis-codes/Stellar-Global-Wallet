import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PortfolioValue } from "@/hooks/usePrices";
import { PortfolioValueCard } from "./PortfolioValueCard";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const base: PortfolioValue = {
  enabled: true,
  isPending: false,
  currency: "USD",
  currencyFallback: false,
  valuation: { total: "1234.5", holdings: [], missing: [], stale: [] },
};

describe("PortfolioValueCard", () => {
  it("renders nothing when prices are disabled", () => {
    const { container } = render(<PortfolioValueCard portfolio={{ ...base, enabled: false }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the formatted total", () => {
    render(<PortfolioValueCard portfolio={base} />);
    expect(screen.getByText("$1,234.50")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("explains missing, stale and fallback-currency values", () => {
    render(
      <PortfolioValueCard
        portfolio={{
          ...base,
          currencyFallback: true,
          valuation: { total: "10", holdings: [], missing: [`AQUA:${ISSUER}`], stale: ["XLM"] },
        }}
      />
    );
    expect(screen.getByText("No price for AQUA; not included in the total.")).toBeInTheDocument();
    expect(screen.getByText("Prices for XLM may be out of date.")).toBeInTheDocument();
    expect(screen.getByText(/conversion to your display currency/)).toBeInTheDocument();
  });
});
