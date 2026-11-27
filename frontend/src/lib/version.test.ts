import { describe, expect, it } from "vitest";
import { compareVersions, isClientOutdated } from "./version";

describe("versions", () => {
  it("compares numerically, not lexically", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("v1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.3-beta.1", "1.2.4")).toBe(-1);
  });

  it("flags clients older than the server minimum", () => {
    expect(isClientOutdated("0.1.0", "0.2.0")).toBe(true);
    expect(isClientOutdated("0.2.0", "0.2.0")).toBe(false);
    expect(isClientOutdated("0.1.0", undefined)).toBe(false);
  });
});
