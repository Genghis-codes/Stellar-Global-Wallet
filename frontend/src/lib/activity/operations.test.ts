import { describe, expect, it } from "vitest";
import type { ActivityItem, PaymentHistoryItem } from "@/lib/api/endpoints/account";
import type { HistoryItem } from "@/lib/api/endpoints/transactions";
import {
  codeFromCanonical,
  operationTypeLabel,
  paymentDirection,
  renderActivityItem,
  renderHistoryItem,
  renderPayment,
} from "./operations";

const ME = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const OTHER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC = { id: `USDC:${OTHER}`, type: "credit_alphanum4" as const, code: "USDC", issuer: OTHER };
const XLM = { id: "XLM", type: "native" as const, code: "XLM", issuer: null };

function item(partial: Partial<HistoryItem>): HistoryItem {
  return {
    id: "1",
    pagingToken: "1",
    type: "other",
    operationType: "payment",
    direction: "self",
    amount: null,
    asset: null,
    sourceAmount: null,
    sourceAsset: null,
    counterparty: null,
    trustlineLimit: null,
    contractFunction: null,
    memo: null,
    memoType: null,
    fee: null,
    feePayer: null,
    transactionHash: "a".repeat(64),
    transactionOperationCount: 1,
    createdAt: "2026-01-01T00:00:00Z",
    successful: true,
    ...partial,
  };
}

describe("renderHistoryItem", () => {
  it("renders incoming and outgoing payments with sign and counterparty", () => {
    const received = renderHistoryItem(item({ type: "payment", direction: "in", amount: "5", asset: USDC, counterparty: OTHER }));
    expect(received).toMatchObject({ kind: "received", title: "Received", sign: "+", assetCode: "USDC", amount: "5" });
    expect(received.description).toBe("from GA5Z…KZVN");

    const sent = renderHistoryItem(item({ type: "payment", direction: "out", amount: "2", asset: XLM, counterparty: OTHER }));
    expect(sent).toMatchObject({ kind: "sent", title: "Sent", sign: "-", description: "to GA5Z…KZVN" });
  });

  it("notes the asset conversion on cross-asset path payments", () => {
    const op = renderHistoryItem(
      item({
        type: "payment",
        operationType: "path_payment_strict_send",
        direction: "out",
        amount: "10",
        asset: USDC,
        sourceAsset: XLM,
        counterparty: OTHER,
      }),
    );
    expect(op.description).toBe("to GA5Z…KZVN (XLM → USDC)");
  });

  it("renders swaps as spent → received", () => {
    const op = renderHistoryItem(item({ type: "swap", amount: "9.5", asset: USDC, sourceAmount: "100", sourceAsset: XLM }));
    expect(op).toMatchObject({ kind: "swap", title: "Swapped", description: "100 XLM → USDC", amount: "9.5", sign: "+" });
  });

  it("tells account funding apart from creating an account", () => {
    expect(renderHistoryItem(item({ type: "account_created", direction: "in", amount: "1", counterparty: OTHER })).title).toBe(
      "Account funded",
    );
    expect(renderHistoryItem(item({ type: "account_created", direction: "out", amount: "1", counterparty: OTHER }))).toMatchObject({
      title: "Created account",
      sign: "-",
    });
  });

  it("renders trustline additions and removals", () => {
    expect(renderHistoryItem(item({ type: "trustline", asset: USDC, trustlineLimit: "922337203685.4775807" })).title).toBe(
      "Added trustline",
    );
    expect(renderHistoryItem(item({ type: "trustline", asset: USDC, trustlineLimit: "0.0000000" }))).toMatchObject({
      kind: "trustline_removed",
      description: "USDC",
    });
  });

  it("renders claimable balances, set options, merges and contract calls", () => {
    expect(renderHistoryItem(item({ operationType: "create_claimable_balance", amount: "3", asset: XLM })).title).toBe(
      "Created claimable balance",
    );
    expect(renderHistoryItem(item({ operationType: "claim_claimable_balance" })).kind).toBe("claimable_claimed");
    expect(renderHistoryItem(item({ operationType: "set_options" })).title).toBe("Changed account settings");
    expect(renderHistoryItem(item({ operationType: "account_merge", direction: "out", counterparty: OTHER })).description).toBe(
      "into GA5Z…KZVN",
    );
    const call = renderHistoryItem(item({ type: "contract", operationType: "invoke_host_function", counterparty: "C".repeat(56) }));
    expect(call).toMatchObject({ kind: "contract", title: "Contract call", amount: null, sign: null });
  });

  it("falls back to a readable label for other operation types", () => {
    expect(renderHistoryItem(item({ operationType: "bump_sequence" })).title).toBe("Bump sequence");
  });

  it("flags failed operations", () => {
    expect(renderHistoryItem(item({ type: "payment", direction: "in", successful: false })).failed).toBe(true);
  });
});

describe("renderPayment", () => {
  const payment = (partial: Partial<PaymentHistoryItem>): PaymentHistoryItem => ({
    id: "1",
    type: "payment",
    transactionHash: "a".repeat(64),
    createdAt: "2026-01-01T00:00:00Z",
    flags: [],
    ...partial,
  });

  it("works out direction from the viewing account", () => {
    expect(paymentDirection(payment({ from: OTHER, to: ME }), ME)).toBe("in");
    expect(paymentDirection(payment({ from: ME, to: OTHER }), ME)).toBe("out");
    expect(paymentDirection(payment({ from: ME, to: ME }), ME)).toBe("self");
  });

  it("renders native and issued payments", () => {
    expect(renderPayment(payment({ from: OTHER, to: ME, amount: "1", assetType: "native" }), ME)).toMatchObject({
      title: "Received",
      assetCode: "XLM",
      sign: "+",
    });
    expect(
      renderPayment(payment({ from: ME, to: OTHER, amount: "1", assetType: "credit_alphanum4", assetCode: "USDC" }), ME),
    ).toMatchObject({ title: "Sent", assetCode: "USDC", sign: "-" });
  });

  it("labels path payments and account operations", () => {
    expect(renderPayment(payment({ type: "path_payment_strict_send", from: OTHER, to: ME }), ME).description).toContain(
      "(path payment)",
    );
    expect(renderPayment(payment({ type: "create_account" }), ME).kind).toBe("account_created");
    expect(renderPayment(payment({ type: "account_merge" }), ME).kind).toBe("merge");
  });
});

describe("renderActivityItem", () => {
  const activity = (partial: Partial<ActivityItem>): ActivityItem => ({
    id: "1",
    source: "payment",
    timestamp: "2026-01-01T00:00:00Z",
    type: "payment",
    details: {},
    ...partial,
  });

  it("renders claimable balance creation with amount and asset", () => {
    const op = renderActivityItem(
      activity({
        source: "claimable_balance",
        type: "create_claimable_balance",
        details: { amount: "7", asset: `USDC:${OTHER}`, sourceAccount: OTHER },
      }),
    );
    expect(op).toMatchObject({ kind: "claimable_created", amount: "7", assetCode: "USDC", description: "by GA5Z…KZVN" });
  });

  it("renders contract events with their topic", () => {
    const op = renderActivityItem(activity({ source: "contract_event", type: "contract_event", details: { topic0: "transfer" } }));
    expect(op.title).toBe("Contract event: transfer");
  });
});

describe("labels", () => {
  it("humanises operation types", () => {
    expect(operationTypeLabel("set_trust_line_flags")).toBe("Set trustline flags");
    expect(operationTypeLabel("brand_new_op")).toBe("Brand new op");
  });

  it("reads canonical asset strings", () => {
    expect(codeFromCanonical("native")).toBe("XLM");
    expect(codeFromCanonical(`USDC:${OTHER}`)).toBe("USDC");
    expect(codeFromCanonical(null)).toBeNull();
  });
});
