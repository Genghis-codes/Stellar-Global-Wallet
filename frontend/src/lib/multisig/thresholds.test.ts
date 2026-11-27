import { describe, expect, it } from "vitest";
import { canRemoveSigner, maxSafeThreshold, parseWeight, simulateSignerChange, type SignerSet } from "./thresholds";

const MASTER = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const C = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";

const single: SignerSet = { account: MASTER, signers: [{ key: MASTER, weight: 1 }], thresholds: { low: 0, medium: 0, high: 0 } };

const twoOfThree: SignerSet = {
  account: MASTER,
  signers: [
    { key: MASTER, weight: 1 },
    { key: B, weight: 1 },
    { key: C, weight: 1 },
  ],
  thresholds: { low: 1, medium: 2, high: 2 },
};

describe("simulateSignerChange", () => {
  it("adds a signer and raises a threshold safely", () => {
    const result = simulateSignerChange(single, { addSigners: [{ key: B, weight: 1 }], thresholds: { high: 2 } });
    expect(result.problems).toEqual([]);
    expect(result.totalWeight).toBe(2);
    expect(result.thresholds).toEqual({ low: 0, medium: 0, high: 2 });
    expect(result.warnings).toContain(`Losing ${MASTER} would leave the account unable to meet its high threshold.`);
  });

  it("blocks a threshold above the combined weight", () => {
    const result = simulateSignerChange(single, { thresholds: { high: 2 } });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(/high threshold \(2\).*combined signer weight \(1\)/);
  });

  it("blocks zeroing every signer", () => {
    const result = simulateSignerChange(single, { masterWeight: 0 });
    expect(result.problems[0]).toMatch(/No signer would have any weight/);
  });

  it("blocks removals that drop below a threshold", () => {
    const result = simulateSignerChange(twoOfThree, { removeSigners: [B, C] });
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it("ignores attempts to remove the master key", () => {
    const result = simulateSignerChange(twoOfThree, { removeSigners: [MASTER] });
    expect(result.signers.map((s) => s.key)).toContain(MASTER);
  });

  it("treats weight 0 as removal and warns about a weightless master", () => {
    const result = simulateSignerChange(twoOfThree, { masterWeight: 0 });
    expect(result.signers.map((s) => s.key)).toEqual([B, C]);
    expect(result.warnings).toContain(
      "The master key will have no weight; only the other signers can act for this account.",
    );
  });

  it("warns when one signer alone meets the high threshold", () => {
    const result = simulateSignerChange(twoOfThree, { addSigners: [{ key: B, weight: 5 }] });
    expect(result.warnings).toContain("A single signer can still authorise high-threshold changes on its own.");
  });

  it("warns about unordered thresholds", () => {
    const result = simulateSignerChange(twoOfThree, { thresholds: { low: 3, medium: 1 } });
    expect(result.warnings).toContain("Thresholds are usually ordered low ≤ medium ≤ high.");
  });

  it("does not warn when there are problems", () => {
    expect(simulateSignerChange(single, { thresholds: { high: 9 } }).warnings).toEqual([]);
  });
});

describe("canRemoveSigner", () => {
  it("allows removing a spare signer", () => {
    expect(canRemoveSigner(twoOfThree, C)).toEqual({ ok: true });
  });

  it("refuses the master key and removals that lock out", () => {
    expect(canRemoveSigner(twoOfThree, MASTER).ok).toBe(false);
    const tight: SignerSet = { ...twoOfThree, thresholds: { low: 1, medium: 3, high: 3 } };
    const verdict = canRemoveSigner(tight, B);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/medium threshold/);
  });
});

describe("maxSafeThreshold / parseWeight", () => {
  it("caps at the combined weight and at 255", () => {
    expect(maxSafeThreshold(twoOfThree.signers)).toBe(3);
    expect(maxSafeThreshold([{ key: MASTER, weight: 255 }, { key: B, weight: 255 }])).toBe(255);
  });

  it("accepts 0–255 integers only", () => {
    expect(parseWeight(" 7 ")).toEqual({ value: 7 });
    expect(parseWeight("0")).toEqual({ value: 0 });
    expect(parseWeight("256")).toEqual({ error: "Must be 255 or less." });
    expect(parseWeight("1.5")).toEqual({ error: "Enter a whole number." });
    expect(parseWeight("")).toEqual({ error: "Enter a whole number." });
  });
});
