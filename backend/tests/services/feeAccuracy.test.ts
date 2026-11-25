import { xdr } from "@stellar/stellar-sdk";
import { extractActualResourceFee } from "../../src/services/soroban";
import {
  recordFeeEstimate,
  recommendedMargin,
  resetFeeAccuracy,
  summarizeFeeAccuracy,
} from "../../src/services/feeAccuracy";

describe("feeAccuracy registry (#287)", () => {
  beforeEach(() => resetFeeAccuracy());

  it("classifies samples into under/ok/over bands", () => {
    recordFeeEstimate({ hash: "a", kind: "soroban", estimatedFee: "100", actualFee: "105" });
    recordFeeEstimate({ hash: "b", kind: "soroban", estimatedFee: "100", actualFee: "50" });
    recordFeeEstimate({ hash: "c", kind: "classic", estimatedFee: "100", actualFee: "200" });
    expect(summarizeFeeAccuracy().bands).toEqual({ ok: 1, over: 1, under: 1 });
    expect(summarizeFeeAccuracy("soroban").count).toBe(2);
  });

  it("skips zero or non-numeric estimates", () => {
    expect(recordFeeEstimate({ hash: "a", kind: "soroban", estimatedFee: "0", actualFee: "5" })).toBeNull();
    expect(recordFeeEstimate({ hash: "b", kind: "soroban", estimatedFee: "x", actualFee: "5" })).toBeNull();
    expect(summarizeFeeAccuracy().count).toBe(0);
  });

  it("raises the margin when under-estimating and clamps it", () => {
    recordFeeEstimate({ hash: "a", kind: "soroban", estimatedFee: "100", actualFee: "300" });
    expect(recommendedMargin(1.2)).toBeCloseTo(1.32);
    expect(recommendedMargin(1.95)).toBe(2);
  });
});

describe("extractActualResourceFee", () => {
  it("returns null when there is no meta", () => {
    expect(extractActualResourceFee(undefined)).toBeNull();
  });

  it("sums refundable and non-refundable resource fees from V4 meta", () => {
    const ext = {
      type: "v1",
      v1: { totalNonRefundableResourceFeeCharged: 1200n, totalRefundableResourceFeeCharged: 34n },
    };
    const meta = { type: "v4", v4: { sorobanMeta: { ext } } } as unknown as xdr.TransactionMeta;
    expect(extractActualResourceFee(meta)).toBe("1234");
  });

  it("returns null when the meta has no fee extension", () => {
    const meta = {
      type: "v3",
      v3: { sorobanMeta: { ext: { type: "v0" } } },
    } as unknown as xdr.TransactionMeta;
    expect(extractActualResourceFee(meta)).toBeNull();
  });
});
