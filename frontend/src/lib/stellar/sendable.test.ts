import { describe, expect, it } from "vitest";
import { amountError, maxSendable } from "./sendable";

describe("maxSendable", () => {
  it("takes the network fee out of XLM only", () => {
    expect(maxSendable("10", true, "100")).toBe("9.99999");
    expect(maxSendable("10", false, "100")).toBe("10");
  });

  it("never goes below zero", () => {
    expect(maxSendable("0.000005", true, 100n)).toBe("0");
  });
});

describe("amountError", () => {
  it("requires a positive, well-formed amount", () => {
    expect(amountError("")).toMatch(/Enter an amount/);
    expect(amountError("abc")).toMatch(/valid amount/);
    expect(amountError("-1")).toMatch(/valid amount/);
    expect(amountError("0")).toMatch(/greater than zero/);
    expect(amountError("0.00000001")).toMatch(/7 decimal/);
    expect(amountError("1.5")).toBeNull();
    expect(amountError(" 2 ")).toBeNull();
  });

  it("enforces the maximum", () => {
    expect(amountError("10", { max: "9.99999", assetCode: "XLM" })).toBe("You can send at most 9.99999 XLM.");
    expect(amountError("9.99999", { max: "9.99999" })).toBeNull();
  });
});
