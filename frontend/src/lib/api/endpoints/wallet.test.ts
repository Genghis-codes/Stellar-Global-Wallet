import { describe, expect, it } from "vitest";
import { callHeaders, errorResponse, jsonResponse, mockFetch } from "@/test/fetch";
import { createApiClient } from "../client";
import { isSubmitPending, walletApi } from "./wallet";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const DEST = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";

const unsigned = {
  xdr: "AAAA",
  networkPassphrase: "Test SDF Network ; September 2015",
  fee: "100",
  sequence: "42",
  timeBounds: { minTime: "0", maxTime: "1700000000" },
  expiresAt: "2023-11-14T22:13:20.000Z",
};

function setup(...responses: Response[]) {
  const fetch = mockFetch(...responses);
  return { fetch, wallet: walletApi(createApiClient({ baseUrl: "http://api.test", fetch })) };
}

const body = (fetch: ReturnType<typeof mockFetch>, index = 0) =>
  JSON.parse(String(fetch.mock.calls[index]![1]?.body));

describe("walletApi builds", () => {
  it("posts a payment build and returns the unsigned envelope", async () => {
    const { fetch, wallet } = setup(jsonResponse({ ...unsigned, operationType: "createAccount" }));
    const result = await wallet.buildSend({ sourcePublicKey: G, destinationPublicKey: DEST, amount: "5", memo: "hi" });

    expect(fetch.mock.calls[0]![0]).toBe("http://api.test/api/v1/wallet/send/build");
    expect(fetch.mock.calls[0]![1]?.method).toBe("POST");
    expect(body(fetch)).toEqual({ sourcePublicKey: G, destinationPublicKey: DEST, amount: "5", memo: "hi" });
    expect(result.operationType).toBe("createAccount");
  });

  it("posts strict-send and strict-receive path payment builds", async () => {
    const build = { ...unsigned, expectedSend: "10", expectedReceive: "9.5", slippageBps: 50, path: [] };
    const { fetch, wallet } = setup(jsonResponse({ ...build, minReceive: "9.45" }), jsonResponse({ ...build, maxSend: "10.05" }));

    await expect(
      wallet.buildStrictSend({
        sourcePublicKey: G,
        destinationPublicKey: G,
        sendAmount: "10",
        destAsset: `USDC:${DEST}`,
        quotedDestAmount: "9.5",
        slippageBps: 50,
      }),
    ).resolves.toMatchObject({ minReceive: "9.45" });
    await expect(
      wallet.buildStrictReceive({
        sourcePublicKey: G,
        destinationPublicKey: G,
        destAmount: "9.5",
        destAsset: `USDC:${DEST}`,
        quotedSendAmount: "10",
      }),
    ).resolves.toMatchObject({ maxSend: "10.05" });

    expect(fetch.mock.calls[0]![0]).toBe("http://api.test/api/v1/wallet/path-payment-strict-send/build");
    expect(body(fetch, 0)).toMatchObject({ sendAmount: "10", quotedDestAmount: "9.5", slippageBps: 50 });
    expect(fetch.mock.calls[1]![0]).toBe("http://api.test/api/v1/wallet/path-payment-strict-receive/build");
    expect(body(fetch, 1)).toMatchObject({ destAmount: "9.5", quotedSendAmount: "10" });
  });

  it("surfaces build errors as ApiErrors", async () => {
    const { wallet } = setup(errorResponse(400, "MEMO_REQUIRED", "memo required"));
    await expect(wallet.buildSend({ sourcePublicKey: G, destinationPublicKey: DEST, amount: "1" })).rejects.toMatchObject({
      code: "MEMO_REQUIRED",
    });
  });
});

describe("walletApi.submit", () => {
  it("sends only the signed XDR in the body and the actor in the query", async () => {
    const { fetch, wallet } = setup(jsonResponse({ hash: "abc", ledger: 7, successful: true }));
    const result = await wallet.submit("SIGNED", { account: G, idempotencyKey: "key-1" });

    expect(fetch.mock.calls[0]![0]).toBe(`http://api.test/api/v1/wallet/submit?sourcePublicKey=${G}`);
    expect(body(fetch)).toEqual({ signedXdr: "SIGNED" });
    expect(callHeaders(fetch)["Idempotency-Key"]).toBe("key-1");
    expect(isSubmitPending(result)).toBe(false);
  });

  it("recognises a pending (202) result", async () => {
    const { fetch, wallet } = setup(jsonResponse({ hash: "abc", status: "pending" }, { status: 202 }));
    const result = await wallet.submit("SIGNED", { account: G });
    expect(isSubmitPending(result)).toBe(true);
    expect(callHeaders(fetch)["Idempotency-Key"]).toBeUndefined();
  });
});

describe("walletApi.precheck", () => {
  it("posts the send parameters and returns the warnings", async () => {
    const result = {
      warnings: [{ code: "DESTINATION_WILL_BE_CREATED", message: "created", blocking: false }],
      blocking: false,
      operationType: "createAccount",
      spendable: "98.5",
    };
    const { fetch, wallet } = setup(jsonResponse(result));
    await expect(
      wallet.precheck({ sourcePublicKey: G, destinationPublicKey: DEST, amount: "5", asset: "XLM" }),
    ).resolves.toEqual(result);
    expect(fetch.mock.calls[0]![0]).toBe("http://api.test/api/v1/wallet/send/precheck");
    expect(body(fetch)).toEqual({ sourcePublicKey: G, destinationPublicKey: DEST, amount: "5", asset: "XLM" });
  });
});

describe("walletApi paths", () => {
  const record = {
    source_asset_type: "native",
    source_amount: "10",
    destination_asset_type: "credit_alphanum4",
    destination_asset_code: "USDC",
    destination_asset_issuer: DEST,
    destination_amount: "1.2",
    path: [],
  };

  it("unwraps strict-send paths and scopes the request to the account", async () => {
    const { fetch, wallet } = setup(jsonResponse({ paths: [record] }));
    await expect(
      wallet.strictSendPaths(G, { sourceAmount: "10", sourceAsset: "XLM", destinationAsset: `USDC:${DEST}` }),
    ).resolves.toEqual([record]);
    expect(fetch.mock.calls[0]![0]).toBe(`http://api.test/api/v1/wallet/paths/strict-send?sourcePublicKey=${G}`);
    expect(body(fetch)).toEqual({ sourceAmount: "10", sourceAsset: "XLM", destinationAsset: `USDC:${DEST}` });
  });

  it("unwraps strict-receive paths", async () => {
    const { fetch, wallet } = setup(jsonResponse({ paths: [] }));
    await expect(wallet.strictReceivePaths(G, { destinationAmount: "1", destinationAsset: "XLM" })).resolves.toEqual([]);
    expect(fetch.mock.calls[0]![0]).toBe(`http://api.test/api/v1/wallet/paths/strict-receive?sourcePublicKey=${G}`);
  });
});

describe("walletApi payment requests", () => {
  it("creates a SEP-7 pay URI", async () => {
    const uri = `web+stellar:pay?destination=${G}&amount=5`;
    const { fetch, wallet } = setup(jsonResponse({ uri }));
    await expect(wallet.createPaymentRequest(G, { destination: G, amount: "5" })).resolves.toEqual({ uri });
    expect(fetch.mock.calls[0]![0]).toBe(`http://api.test/api/v1/wallet/payment-requests?sourcePublicKey=${G}`);
    expect(body(fetch)).toEqual({ destination: G, amount: "5" });
  });

  it("parses a URI into fields and warnings", async () => {
    const parsed = { fields: { destination: G, memo: "7", memo_type: "MEMO_ID" }, warnings: [] };
    const { fetch, wallet } = setup(jsonResponse(parsed));
    await expect(wallet.parsePaymentRequest(G, "web+stellar:pay?x")).resolves.toEqual(parsed);
    expect(fetch.mock.calls[0]![0]).toBe(`http://api.test/api/v1/wallet/payment-requests/parse?sourcePublicKey=${G}`);
    expect(body(fetch)).toEqual({ uri: "web+stellar:pay?x" });
  });
});

describe("walletApi.sponsorFee", () => {
  it("posts the signed inner transaction with the account as innerAccount", async () => {
    const { fetch, wallet } = setup(jsonResponse({ hash: "h", successful: true }));
    await expect(wallet.sponsorFee(G, "SIGNED")).resolves.toEqual({ hash: "h", successful: true });
    expect(fetch.mock.calls[0]![0]).toBe("http://api.test/api/v1/wallet/sponsor-fee");
    expect(body(fetch)).toEqual({ transactionXdr: "SIGNED", innerAccount: G });
  });

  it("reports an unconfigured sponsor", async () => {
    const { wallet } = setup(errorResponse(503, "FEE_SPONSOR_NOT_CONFIGURED"));
    await expect(wallet.sponsorFee(G, "SIGNED")).rejects.toMatchObject({ code: "FEE_SPONSOR_NOT_CONFIGURED" });
  });
});
