import { describe, expect, it } from "vitest";
import { formatAmount, formatCompact, formatFiat, truncateAddress } from "./format";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

describe("truncateAddress", () => {
  it("keeps the first and last characters", () => {
    expect(truncateAddress(G)).toBe("GBRP…OX2H");
    expect(truncateAddress(G, 6, 6)).toBe("GBRPYH…C7OX2H");
  });

  it("leaves short strings alone", () => {
    expect(truncateAddress("GABC")).toBe("GABC");
  });
});

describe("formatAmount", () => {
  it("trims trailing zeros and groups thousands", () => {
    expect(formatAmount("1234567.5000000")).toBe("1,234,567.5");
    expect(formatAmount("100.0000000")).toBe("100");
    expect(formatAmount("0.0000001")).toBe("0.0000001");
  });

  it("rounds half-up at maxDecimals, carrying into the integer", () => {
    expect(formatAmount("1.23456", { maxDecimals: 2 })).toBe("1.23");
    expect(formatAmount("1.235", { maxDecimals: 2 })).toBe("1.24");
    expect(formatAmount("9.999", { maxDecimals: 2 })).toBe("10");
    expect(formatAmount("999.5", { maxDecimals: 0 })).toBe("1,000");
  });

  it("pads to minDecimals", () => {
    expect(formatAmount("5", { minDecimals: 2 })).toBe("5.00");
    expect(formatAmount("5.1", { minDecimals: 2 })).toBe("5.10");
  });

  it("keeps precision beyond Number range", () => {
    expect(formatAmount("922337203685.4775807")).toBe("922,337,203,685.4775807");
  });

  it("handles signs, leading zeros, grouping off and bad input", () => {
    expect(formatAmount("-0012.50")).toBe("-12.5");
    expect(formatAmount("-0.0000000")).toBe("0");
    expect(formatAmount(".5")).toBe("0.5");
    expect(formatAmount("12345", { group: false })).toBe("12345");
    expect(formatAmount("abc")).toBe("abc");
    expect(formatAmount(2.5)).toBe("2.5");
  });
});

describe("formatCompact / formatFiat", () => {
  it("formats compact numbers", () => {
    expect(formatCompact("1234567")).toBe("1.23M");
    expect(formatCompact("nope")).toBe("nope");
  });

  it("formats fiat currency", () => {
    expect(formatFiat("12.5")).toBe("$12.50");
    expect(formatFiat("x")).toBe("—");
  });
});
