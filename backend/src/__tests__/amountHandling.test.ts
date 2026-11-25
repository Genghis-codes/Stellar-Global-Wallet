import {
  toStroops,
  fromStroops,
  compareStroops,
  addStroops,
  subStroops,
} from "../utils/stroops";
import { isDustAmount } from "../services/paymentFlags";
import { convertFromUsd } from "../services/fx";

describe("Amount Handling: Stroop Precision Arithmetic (#218)", () => {
  it("converts amounts to and from stroops with exact precision", () => {
    // 1 stroop
    expect(toStroops("0.0000001")).toBe(1n);
    expect(fromStroops(1n)).toBe("0.0000001");

    // Standard whole numbers
    expect(toStroops("10")).toBe(100_000_000n);
    expect(fromStroops(100_000_000n)).toBe("10.0000000");

    // Large numbers above JS 2^53 safe integer limit
    const largeAmount = "922337203685.4775807";
    const largeStroops = 9223372036854775807n;
    expect(toStroops(largeAmount)).toBe(largeStroops);
    expect(fromStroops(largeStroops)).toBe(largeAmount);
  });

  it("adds and subtracts without floating point drift (0.1 + 0.2)", () => {
    // Floating point in JS produces 0.30000000000000004
    const sum = addStroops("0.1", "0.2");
    expect(sum).toBe("0.3000000");

    const diff = subStroops("0.3", "0.1");
    expect(diff).toBe("0.2000000");
  });

  it("compares amounts safely", () => {
    expect(compareStroops("1.0000000", "1.0000000")).toBe(0);
    expect(compareStroops("0.9999999", "1.0000000")).toBe(-1);
    expect(compareStroops("1.0000001", "1.0000000")).toBe(1);
  });

  it("checks dust amounts without floating point errors", () => {
    expect(isDustAmount("0.0000001", 0.5)).toBe(true);
    expect(isDustAmount("0.5000000", 0.5)).toBe(false);
    expect(isDustAmount("10.0", 0.5)).toBe(false);
  });

  it("converts FX amounts without losing precision", () => {
    const converted = convertFromUsd("100.50", "1.25");
    expect(converted).toBe("125.63");
  });
});

describe("convertFromUsd rounding", () => {
  it("carries a fractional part that rounds up into the integer part", () => {
    expect(convertFromUsd("1.999", "1")).toBe("2.00");
    expect(convertFromUsd("9.996", "1")).toBe("10.00");
  });

  it("keeps 7 decimals below one unit", () => {
    expect(convertFromUsd("0.5", "0.5")).toBe("0.2500000");
  });

  it("returns null for a null amount", () => {
    expect(convertFromUsd(null, "1.5")).toBeNull();
  });
});
