import { describe, expect, it } from "vitest";
import type { PaymentPath } from "@/lib/api/endpoints/wallet";
import { bestPath, destinationAssetId, exchangeRate, pathAssetIds, sourceAssetId } from "./paths";

const ISSUER = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const USDC = `USDC:${ISSUER}`;

function path(sourceAmount: string, destinationAmount: string, hops: PaymentPath["path"] = []): PaymentPath {
  return {
    source_asset_type: "native",
    source_amount: sourceAmount,
    destination_asset_type: "credit_alphanum4",
    destination_asset_code: "USDC",
    destination_asset_issuer: ISSUER,
    destination_amount: destinationAmount,
    path: hops,
  };
}

describe("path helpers", () => {
  it("converts Horizon assets to backend asset ids", () => {
    const record = path("10", "1.2", [{ asset_type: "credit_alphanum4", asset_code: "EURC", asset_issuer: ISSUER }, { asset_type: "native" }]);
    expect(sourceAssetId(record)).toBe("XLM");
    expect(destinationAssetId(record)).toBe(USDC);
    expect(pathAssetIds(record)).toEqual([`EURC:${ISSUER}`, "XLM"]);
  });

  it("picks the most received for strict-send and the least spent for strict-receive", () => {
    const paths = [path("10", "1.1"), path("10", "1.3"), path("9", "1.2")];
    expect(bestPath(paths, "strict-send", "XLM", USDC)?.destination_amount).toBe("1.3");
    expect(bestPath(paths, "strict-receive", "XLM", USDC)?.source_amount).toBe("9");
  });

  it("ignores routes for other assets", () => {
    expect(bestPath([path("10", "1")], "strict-send", "XLM", `USDC:${"G".repeat(56)}`)).toBeNull();
    expect(bestPath([], "strict-send", "XLM", USDC)).toBeNull();
  });

  it("computes an exact rate", () => {
    expect(exchangeRate(path("8", "1"))).toBe("0.125");
    expect(exchangeRate(path("3", "1"))).toBe("0.3333333");
    expect(exchangeRate(path("0", "1"))).toBe("0");
  });
});
