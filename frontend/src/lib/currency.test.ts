import { describe, expect, it } from "vitest";
import { DISPLAY_CURRENCIES, resolveDisplayCurrency } from "./currency";

describe("resolveDisplayCurrency", () => {
  it("uses USD by default", () => {
    expect(resolveDisplayCurrency(undefined)).toEqual({ code: "USD", fallback: false });
    expect(resolveDisplayCurrency("usd")).toEqual({ code: "USD", fallback: false });
  });

  it("falls back to USD for currencies without rates", () => {
    expect(resolveDisplayCurrency("EUR")).toEqual({ code: "USD", fallback: true });
  });

  it("lists unique ISO codes", () => {
    const codes = DISPLAY_CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => /^[A-Z]{3}$/.test(code))).toBe(true);
  });
});
