import { describe, expect, it } from "vitest";
import type { PriceQuote } from "@/lib/api/endpoints/price";
import { multiplyDecimal, quoteState, sumDecimals, valuePortfolio } from "./valuation";

const NOW = Date.parse("2026-06-01T12:00:00Z");
const quote = (asset: string, price: string | null, updatedAt: string | null = "2026-06-01T11:59:00Z"): PriceQuote => ({
  asset,
  price,
  currency: "USD",
  source: price === null ? "unavailable" : "stellar_dex",
  updatedAt,
});

describe("multiplyDecimal", () => {
  it("multiplies exactly and rounds half-up", () => {
    expect(multiplyDecimal("100.0000000", "0.1234")).toBe("12.34");
    expect(multiplyDecimal("922337203685.4775807", "1")).toBe("922337203685.4775807");
    expect(multiplyDecimal("0.0000001", "0.000000015")).toBe("0");
    expect(multiplyDecimal("1", "0.000000005")).toBe("0.00000001");
    expect(multiplyDecimal("abc", "1")).toBeNull();
  });

  it("sums decimal strings", () => {
    expect(sumDecimals(["0.1", "0.2", "10"])).toBe("10.3");
    expect(sumDecimals([])).toBe("0");
  });
});

describe("quoteState", () => {
  it("classifies missing, stale and fresh quotes", () => {
    expect(quoteState(undefined, NOW)).toBe("missing");
    expect(quoteState(quote("XLM", null), NOW)).toBe("missing");
    expect(quoteState(quote("XLM", "0.1", "2026-06-01T11:00:00Z"), NOW)).toBe("stale");
    expect(quoteState(quote("XLM", "0.1", null), NOW)).toBe("stale");
    expect(quoteState(quote("XLM", "0.1"), NOW)).toBe("fresh");
  });
});

describe("valuePortfolio", () => {
  it("totals priced holdings and lists missing and stale ones", () => {
    const result = valuePortfolio(
      [
        { asset: "XLM", amount: "100" },
        { asset: "USDC:G1", amount: "25.5" },
        { asset: "AQUA:G2", amount: "1000" },
      ],
      [quote("XLM", "0.12", "2026-06-01T10:00:00Z"), quote("USDC:G1", "1"), quote("AQUA:G2", null)],
      NOW
    );
    expect(result.total).toBe("37.5");
    expect(result.stale).toEqual(["XLM"]);
    expect(result.missing).toEqual(["AQUA:G2"]);
    expect(result.holdings[2]).toMatchObject({ value: null, state: "missing" });
  });
});
