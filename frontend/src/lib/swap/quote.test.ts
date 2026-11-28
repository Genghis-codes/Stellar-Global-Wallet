import { describe, expect, it } from "vitest";
import type { PaymentPath } from "@/lib/api/endpoints/wallet";
import {
  assetCodeOf,
  bestPath,
  exchangeRate,
  formatBps,
  horizonAssetId,
  maxSent,
  minReceived,
  parseSlippagePercent,
  pathAssetIds,
  routeCodes,
} from "./quote";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const AQUA = "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA";

function path(source: string, destination: string, hops: PaymentPath["path"] = []): PaymentPath {
  return {
    source_asset_type: "native",
    source_amount: source,
    destination_asset_type: "credit_alphanum4",
    destination_asset_code: "USDC",
    destination_asset_issuer: ISSUER,
    destination_amount: destination,
    path: hops,
  };
}

describe("asset ids", () => {
  it("maps Horizon fields to backend ids and codes", () => {
    expect(horizonAssetId("native")).toBe("XLM");
    expect(horizonAssetId("credit_alphanum4", "USDC", ISSUER)).toBe(`USDC:${ISSUER}`);
    expect(assetCodeOf(`USDC:${ISSUER}`)).toBe("USDC");
    expect(assetCodeOf("native")).toBe("XLM");
  });

  it("lists hops and the full route", () => {
    const p = path("10", "1", [{ asset_type: "credit_alphanum4", asset_code: "AQUA", asset_issuer: AQUA }]);
    expect(pathAssetIds(p)).toEqual([`AQUA:${AQUA}`]);
    expect(routeCodes(p)).toEqual(["XLM", "AQUA", "USDC"]);
  });
});

describe("bestPath", () => {
  const paths = [path("10", "1.1"), path("9", "1.3"), path("8", "1.2")];

  it("picks the largest output for strict-send and the smallest input for strict-receive", () => {
    expect(bestPath(paths, "send")?.destination_amount).toBe("1.3");
    expect(bestPath(paths, "receive")?.source_amount).toBe("8");
    expect(bestPath([], "send")).toBeNull();
  });
});

describe("slippage", () => {
  it("matches the backend rounding", () => {
    expect(minReceived("100", 50)).toBe("99.5");
    expect(minReceived("0.0000001", 50)).toBe("0.0000001");
    expect(minReceived("1.0000003", 50)).toBe("0.9950002");
    expect(maxSent("100", 50)).toBe("100.5");
    expect(maxSent("1.0000003", 50)).toBe("1.0050004");
  });

  it("formats and parses percentages", () => {
    expect(formatBps(50)).toBe("0.5%");
    expect(formatBps(100)).toBe("1%");
    expect(formatBps(25)).toBe("0.25%");
    expect(parseSlippagePercent("0.5")).toBe(50);
    expect(parseSlippagePercent("5")).toBe(500);
    expect(parseSlippagePercent("5.01")).toBeNull();
    expect(parseSlippagePercent("abc")).toBeNull();
  });
});

describe("exchangeRate", () => {
  it("divides exactly in stroops", () => {
    expect(exchangeRate("10", "1.3")).toBe("0.13");
    expect(exchangeRate("3", "1")).toBe("0.3333333");
    expect(exchangeRate("0", "1")).toBeNull();
  });
});
