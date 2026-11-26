import { describe, expect, it } from "vitest";
import { parseNetwork, parseTimeout, readEnv } from "./env";

describe("env", () => {
  it("applies defaults", () => {
    expect(readEnv({})).toEqual({
      apiUrl: "http://localhost:4000",
      network: "testnet",
      horizonUrl: "https://horizon-testnet.stellar.org",
      explorerUrl: "https://stellar.expert/explorer",
      apiTimeoutMs: 15_000,
    });
  });

  it("derives the Horizon default from the network and trims slashes", () => {
    const e = readEnv({ NEXT_PUBLIC_STELLAR_NETWORK: "mainnet", NEXT_PUBLIC_API_URL: "https://api.example.com/" });
    expect(e.horizonUrl).toBe("https://horizon.stellar.org");
    expect(e.apiUrl).toBe("https://api.example.com");
  });

  it("normalises network aliases and bad values", () => {
    expect(parseNetwork("PUBLIC")).toBe("mainnet");
    expect(parseNetwork("futurenet")).toBe("futurenet");
    expect(parseNetwork("moon")).toBe("testnet");
  });

  it("rejects non-positive timeouts", () => {
    expect(parseTimeout("0")).toBe(15_000);
    expect(parseTimeout("abc", 5)).toBe(5);
    expect(parseTimeout("2500")).toBe(2500);
  });
});
