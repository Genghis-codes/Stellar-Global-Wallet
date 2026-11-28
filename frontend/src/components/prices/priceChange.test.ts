import { describe, expect, it } from "vitest";
import { formatPercent, percentChange, toChartPoints } from "./priceChange";

describe("price change", () => {
  it("converts history points and keeps gaps", () => {
    expect(
      toChartPoints([
        { t: "2026-06-01T00:00:00Z", price: "0.1", filled: false },
        { t: "2026-06-02T00:00:00Z", price: null, filled: true },
      ])
    ).toEqual([
      { t: Date.parse("2026-06-01T00:00:00Z"), value: 0.1 },
      { t: Date.parse("2026-06-02T00:00:00Z"), value: null },
    ]);
  });

  it("computes the change between the first and last priced points", () => {
    expect(
      percentChange([
        { t: 0, value: null },
        { t: 1, value: 2 },
        { t: 2, value: 3 },
      ])
    ).toBe(50);
    expect(percentChange([{ t: 0, value: 2 }])).toBeNull();
    expect(formatPercent(50)).toBe("+50.00%");
    expect(formatPercent(-1.234)).toBe("−1.23%");
    expect(formatPercent(0)).toBe("0.00%");
  });
});
