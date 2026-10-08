import request from "supertest";
import { createApp } from "../../src/app";
import { StellarService } from "../../src/services/stellar";
import { GlobeWalletContract } from "../../src/services/contracts/globeWallet";

function buildApp() {
  const stellar = {
    sendPayment: jest.fn(),
    feeBumpTransaction: jest.fn(),
    pathPaymentStrictSend: jest.fn(),
    pathPaymentStrictReceive: jest.fn(),
    buildPartialTransaction: jest.fn(),
    submitWithAdditionalSignatures: jest.fn(),
  } as unknown as StellarService;
  const globeWallet = {
    recordSpend: jest.fn(),
  } as unknown as GlobeWalletContract;
  return createApp(stellar, globeWallet);
}

async function getAccessToken(app: import("express").Express): Promise<string> {
  const login = await request(app).post("/api/v1/auth/login").set("x-api-key", "test-api-key");
  return login.body.accessToken;
}

const VALID_PUBKEY = "GBLIQBXTAF3O3YINCRDR5O7H47QHHW5GFOYN4HAD6IKOSWD4LWKWWPHP";
const OVERSIZED_SECRET = "S" + "A".repeat(300);

describe("Secret key length validation", () => {
  let app: import("express").Express;
  let accessToken: string;

  beforeAll(async () => {
    app = buildApp();
    accessToken = await getAccessToken(app);
  });

  const testCases = [
    {
      route: "/api/v1/wallet/send",
      payload: { sourceSecretKey: OVERSIZED_SECRET, destinationPublicKey: VALID_PUBKEY, amount: "1" },
    },
    {
      route: "/api/v1/wallet/path-payment-strict-send",
      payload: { sourceSecretKey: OVERSIZED_SECRET, destinationPublicKey: VALID_PUBKEY, sendAmount: "1", destAsset: "XLM", destMin: "1" },
    },
    {
      route: "/api/v1/wallet/path-payment-strict-receive",
      payload: { sourceSecretKey: OVERSIZED_SECRET, destinationPublicKey: VALID_PUBKEY, destAmount: "1", destAsset: "XLM", sendMax: "1" },
    },
    {
      route: "/api/v1/wallet/partial-transaction",
      payload: { sourceSecretKey: OVERSIZED_SECRET, destinationPublicKey: VALID_PUBKEY, amount: "1" },
    },
    {
      route: "/api/v1/wallet/fee-bump",
      payload: { feeSecretKey: OVERSIZED_SECRET, transactionXdr: "AAAA" },
    },
    {
      route: "/api/v1/wallet/submit-multisig",
      payload: { signerSecretKeys: [OVERSIZED_SECRET], xdr: "AAAA" },
    },
    {
      route: "/api/v1/contract/wallet/spend",
      payload: { userSecretKey: OVERSIZED_SECRET, assetCode: "XLM", amount: "1" },
    },
  ];

  test.each(testCases)("$route rejects oversized secret key with 400 validation error", async ({ route, payload }) => {
    const res = await request(app)
      .post(route)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(payload)
      .expect(400);

    expect(res.body.errors).toBeDefined();
  });
});
