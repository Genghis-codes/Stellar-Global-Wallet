import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseVerifiedAssetFile } from "../../src/services/verifiedAssets";

const USDC = {
  code: "USDC",
  issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  domain: "centre.io",
  name: "USD Coin",
};

describe("verified asset files (#54)", () => {
  it.each(["testnet", "mainnet"])("ships a valid %s list", (network) => {
    const raw = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "data", `verified-assets.${network}.json`), "utf8")
    );
    expect(parseVerifiedAssetFile(raw, network).length).toBeGreaterThan(0);
  });

  it("accepts a well-formed entry", () => {
    expect(parseVerifiedAssetFile({ network: "mainnet", assets: [USDC] }, "mainnet")).toEqual([USDC]);
  });

  it.each([
    ["a network mismatch", { network: "testnet", assets: [USDC] }],
    ["an unknown field", { network: "mainnet", assets: [{ ...USDC, logo: "x" }] }],
    ["a bad issuer checksum", { network: "mainnet", assets: [{ ...USDC, issuer: USDC.issuer.slice(0, -1) + "A" }] }],
    ["a malformed code", { network: "mainnet", assets: [{ ...USDC, code: "TOO-LONG-CODE!" }] }],
    ["a malformed domain", { network: "mainnet", assets: [{ ...USDC, domain: "not a domain" }] }],
    ["a duplicate", { network: "mainnet", assets: [USDC, USDC] }],
    [
      "two usdPeg entries",
      {
        network: "mainnet",
        assets: [
          { ...USDC, usdPeg: true },
          { ...USDC, code: "USDT", usdPeg: true },
        ],
      },
    ],
  ])("rejects %s", (_label, raw) => {
    expect(() => parseVerifiedAssetFile(raw, "mainnet")).toThrow();
  });
});
