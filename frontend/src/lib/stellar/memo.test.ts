import { describe, expect, it } from "vitest";
import { memoTextByteLength, memoTypeFromSep7, memoTypeToSep7, validateMemo } from "./memo";

describe("validateMemo", () => {
  it("accepts empty memos and the none type", () => {
    expect(validateMemo("text", "")).toBeNull();
    expect(validateMemo("none", "anything")).toBeNull();
  });

  it("limits text memos to 28 UTF-8 bytes, not characters", () => {
    expect(validateMemo("text", "a".repeat(28))).toBeNull();
    expect(validateMemo("text", "a".repeat(29))).toMatch(/29 bytes/);
    // 10 characters, 40 bytes.
    expect(memoTextByteLength("😀".repeat(10))).toBe(40);
    expect(validateMemo("text", "😀".repeat(10))).toMatch(/40 bytes/);
  });

  it("checks id memos are uint64", () => {
    expect(validateMemo("id", "0")).toBeNull();
    expect(validateMemo("id", "18446744073709551615")).toBeNull();
    expect(validateMemo("id", "18446744073709551616")).toMatch(/too large/);
    expect(validateMemo("id", "-1")).toMatch(/whole number/);
    expect(validateMemo("id", "1.5")).toMatch(/whole number/);
  });

  it("checks hash memos are 32 bytes of hex", () => {
    expect(validateMemo("hash", "ab".repeat(32))).toBeNull();
    expect(validateMemo("hash", "AB".repeat(32))).toBeNull();
    expect(validateMemo("hash", "ab".repeat(31))).toMatch(/64 hexadecimal/);
    expect(validateMemo("hash", "zz".repeat(32))).toMatch(/64 hexadecimal/);
  });
});

describe("SEP-7 memo types", () => {
  it("maps memo_type values both ways", () => {
    expect(memoTypeFromSep7("MEMO_ID")).toBe("id");
    expect(memoTypeFromSep7("memo_hash")).toBe("hash");
    expect(memoTypeFromSep7("MEMO_RETURN")).toBe("hash");
    expect(memoTypeFromSep7(undefined)).toBe("text");
    expect(memoTypeToSep7("id")).toBe("MEMO_ID");
    expect(memoTypeToSep7("text")).toBe("MEMO_TEXT");
    expect(memoTypeToSep7("hash")).toBe("MEMO_HASH");
  });
});
