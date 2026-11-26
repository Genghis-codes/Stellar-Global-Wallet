import { describe, expect, it } from "vitest";
import {
  addAmounts,
  assetFromBalanceLine,
  assetId,
  compareAmounts,
  compareAssets,
  explorerUrl,
  fromStroops,
  isAccountId,
  isContractId,
  isFederationAddress,
  isMuxedAddress,
  isValidAmount,
  NATIVE,
  networkFromPassphrase,
  networkPassphrase,
  parseAssetId,
  subtractAmounts,
  toStroops,
} from ".";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const USDC = { code: "USDC", issuer: G };

describe("network", () => {
  it("maps networks to passphrases and back", () => {
    expect(networkPassphrase("testnet")).toBe("Test SDF Network ; September 2015");
    expect(networkPassphrase("mainnet")).toBe("Public Global Stellar Network ; September 2015");
    expect(networkFromPassphrase("Test SDF Future Network ; October 2022")).toBe("futurenet");
    expect(networkFromPassphrase("Standalone Network ; February 2017")).toBeNull();
  });
});

describe("explorer", () => {
  it("builds stellar.expert links per network", () => {
    expect(explorerUrl("tx", "abc", "testnet", "https://stellar.expert/explorer")).toBe(
      "https://stellar.expert/explorer/testnet/tx/abc",
    );
    expect(explorerUrl("account", G, "mainnet", "https://x.test")).toBe(`https://x.test/public/account/${G}`);
  });
});

describe("address", () => {
  it("validates address kinds", () => {
    expect(isAccountId(G)).toBe(true);
    expect(isAccountId(G.slice(0, -1) + "A")).toBe(false);
    expect(isMuxedAddress(G)).toBe(false);
    expect(isContractId(G)).toBe(false);
    expect(isFederationAddress("alice*example.com")).toBe(true);
    expect(isFederationAddress("alice@example.com")).toBe(false);
  });
});

describe("amount", () => {
  it("converts between units and stroops exactly", () => {
    expect(toStroops("1")).toBe(10_000_000n);
    expect(toStroops("0.0000001")).toBe(1n);
    expect(toStroops("922337203685.4775807")).toBe(9_223_372_036_854_775_807n);
    expect(fromStroops(15_000_000n)).toBe("1.5");
    expect(fromStroops("-1")).toBe("-0.0000001");
    expect(() => toStroops("1.12345678")).toThrow();
  });

  it("validates amounts", () => {
    expect(isValidAmount("10.5")).toBe(true);
    expect(isValidAmount("10.12345678")).toBe(false);
    expect(isValidAmount("-1")).toBe(false);
    expect(isValidAmount("922337203685.4775808")).toBe(false);
  });

  it("does exact arithmetic and comparison", () => {
    expect(addAmounts("0.1", "0.2")).toBe("0.3");
    expect(subtractAmounts("1", "1.5")).toBe("-0.5");
    expect(compareAmounts("1.0000000", "1")).toBe(0);
    expect(compareAmounts("0.9", "1")).toBe(-1);
  });
});

describe("asset", () => {
  it("formats and parses asset ids", () => {
    expect(assetId(NATIVE)).toBe("XLM");
    expect(assetId(USDC)).toBe(`USDC:${G}`);
    expect(parseAssetId(`USDC:${G}`)).toEqual(USDC);
    expect(parseAssetId("native")).toEqual(NATIVE);
    expect(parseAssetId("USDC")).toBeNull();
    expect(parseAssetId("USDC:nope")).toBeNull();
  });

  it("reads balance lines and sorts native first", () => {
    expect(assetFromBalanceLine({ asset_type: "native", balance: "1" })).toEqual(NATIVE);
    expect(
      assetFromBalanceLine({ asset_type: "credit_alphanum4", balance: "1", asset_code: "USDC", asset_issuer: G }),
    ).toEqual(USDC);
    expect(assetFromBalanceLine({ asset_type: "liquidity_pool_shares", balance: "1" })).toBeNull();
    expect([USDC, { code: "AQUA", issuer: G }, NATIVE].sort(compareAssets).map((a) => a.code)).toEqual([
      "XLM",
      "AQUA",
      "USDC",
    ]);
  });
});
