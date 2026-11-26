import { describe, expect, it } from "vitest";
import type { PaymentHistoryItem } from "@/lib/api/endpoints/account";
import {
  DEFAULT_FILTERS,
  assetOptions,
  filterPayments,
  filtersFromSearchParams,
  filtersToSearchParams,
  hasActiveFilters,
  isPastDateRange,
  paymentAssetId,
} from "./filters";

const ME = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const OTHER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const p = (partial: Partial<PaymentHistoryItem>): PaymentHistoryItem => ({
  id: partial.id ?? "1",
  type: "payment",
  transactionHash: "a".repeat(64),
  createdAt: "2026-03-10T12:00:00",
  flags: [],
  ...partial,
});

const items = [
  p({ id: "in-xlm", from: OTHER, to: ME, assetType: "native", amount: "1" }),
  p({ id: "out-usdc", from: ME, to: OTHER, assetType: "credit_alphanum4", assetCode: "USDC", assetIssuer: OTHER, createdAt: "2026-03-05T09:00:00" }),
  p({ id: "path", type: "path_payment_strict_send", from: ME, to: OTHER, assetType: "native", createdAt: "2026-02-01T09:00:00" }),
  p({ id: "create", type: "create_account", createdAt: "2026-01-01T09:00:00" }),
];

const ids = (list: PaymentHistoryItem[]) => list.map((i) => i.id);

describe("filterPayments", () => {
  it("returns everything with the default filters", () => {
    expect(filterPayments(items, DEFAULT_FILTERS, ME)).toHaveLength(4);
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
  });

  it("filters by type", () => {
    expect(ids(filterPayments(items, { ...DEFAULT_FILTERS, type: "path_payment" }, ME))).toEqual(["path"]);
    expect(ids(filterPayments(items, { ...DEFAULT_FILTERS, type: "account" }, ME))).toEqual(["create"]);
  });

  it("filters by direction", () => {
    expect(ids(filterPayments(items, { ...DEFAULT_FILTERS, direction: "in" }, ME))).toEqual(["in-xlm"]);
    expect(ids(filterPayments(items, { ...DEFAULT_FILTERS, direction: "out" }, ME))).toEqual(["out-usdc", "path"]);
  });

  it("filters by asset id", () => {
    expect(ids(filterPayments(items, { ...DEFAULT_FILTERS, asset: `USDC:${OTHER}` }, ME))).toEqual(["out-usdc"]);
    expect(ids(filterPayments(items, { ...DEFAULT_FILTERS, asset: "XLM" }, ME))).toEqual(["in-xlm", "path"]);
  });

  it("filters by inclusive local date range", () => {
    const f = { ...DEFAULT_FILTERS, from: "2026-02-01", to: "2026-03-05" };
    expect(ids(filterPayments(items, f, ME))).toEqual(["out-usdc", "path"]);
    expect(hasActiveFilters(f)).toBe(true);
  });

  it("knows when the newest-first feed has passed the start date", () => {
    const f = { ...DEFAULT_FILTERS, from: "2026-02-01" };
    expect(isPastDateRange(items[3], f)).toBe(true);
    expect(isPastDateRange(items[0], f)).toBe(false);
    expect(isPastDateRange(items[3], DEFAULT_FILTERS)).toBe(false);
  });
});

describe("asset helpers", () => {
  it("derives asset ids and options, XLM first", () => {
    expect(paymentAssetId(items[0]!)).toBe("XLM");
    expect(paymentAssetId(items[3]!)).toBeNull();
    expect(assetOptions(items)).toEqual(["XLM", `USDC:${OTHER}`]);
  });
});

describe("URL round trip", () => {
  it("serialises only non-default values and drops junk", () => {
    const f = { ...DEFAULT_FILTERS, direction: "in" as const, from: "2026-01-01" };
    const params = filtersToSearchParams(f);
    expect(params.toString()).toBe("direction=in&from=2026-01-01");
    expect(filtersFromSearchParams(params)).toEqual(f);
    expect(filtersFromSearchParams(new URLSearchParams("type=bogus&from=yesterday"))).toEqual(DEFAULT_FILTERS);
  });
});
