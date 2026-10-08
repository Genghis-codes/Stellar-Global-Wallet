const mockPathPaymentStrictSend = jest.fn().mockResolvedValue({
  hash: "strict-send-hash",
  successful: true,
});
const mockPathPaymentStrictReceive = jest.fn().mockResolvedValue({
  hash: "strict-receive-hash",
  successful: true,
});

jest.mock("../../src/services/stellar", () => ({
  StellarService: jest.fn().mockImplementation(() => ({
    pathPaymentStrictSend: mockPathPaymentStrictSend,
    pathPaymentStrictReceive: mockPathPaymentStrictReceive,
  })),
}));

import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { createApp } from "../../src/app";

const app = createApp();
const destinationPublicKey = "GBZH7QMRVYFLVYQRY6O5SOM3G7MSQF7MMUEM3WUOGRV26W3R3K5M7G8A";
const issuedAsset = `USDC:${StellarSdk.Keypair.random().publicKey()}`;

async function getAuthToken(): Promise<string> {
  const response = await request(app)
    .post("/api/v1/auth/login")
    .set("x-api-key", "test-api-key");
  return response.body.accessToken;
}

function strictSendBody(path: unknown[]) {
  return {
    sourceSecretKey: "S".repeat(56),
    destinationPublicKey,
    sendAmount: "10",
    destAsset: issuedAsset,
    destMin: "9",
    path,
  };
}

function strictReceiveBody(path: unknown[]) {
  return {
    sourceSecretKey: "S".repeat(56),
    destinationPublicKey,
    destAmount: "9",
    destAsset: issuedAsset,
    sendMax: "10",
    path,
  };
}

describe.each([
  ["path-payment-strict-send", mockPathPaymentStrictSend, strictSendBody],
  ["path-payment-strict-receive", mockPathPaymentStrictReceive, strictReceiveBody],
])("POST /api/v1/wallet/%s", (endpoint, serviceMethod, createBody) => {
  beforeEach(() => {
    serviceMethod.mockClear();
  });

  it("rejects paths longer than five hops with 400", async () => {
    const token = await getAuthToken();
    const response = await request(app)
      .post(`/api/v1/wallet/${endpoint}`)
      .set("Authorization", `Bearer ${token}`)
      .send(createBody(Array(8).fill(issuedAsset)))
      .expect(400);

    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(response.body.details).toContainEqual(
      expect.objectContaining({
        path: "path",
        message: "Path must contain at most 5 assets",
      })
    );
    expect(serviceMethod).not.toHaveBeenCalled();
  });

  it("rejects malformed path assets with 400", async () => {
    const token = await getAuthToken();
    const response = await request(app)
      .post(`/api/v1/wallet/${endpoint}`)
      .set("Authorization", `Bearer ${token}`)
      .send(createBody(["USDC-without-an-issuer"]))
      .expect(400);

    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(response.body.details).toContainEqual(
      expect.objectContaining({
        path: "path",
        message: "Each path asset must use the CODE:ISSUER format",
      })
    );
    expect(serviceMethod).not.toHaveBeenCalled();
  });

  it("accepts a valid issued-asset path", async () => {
    const token = await getAuthToken();
    const response = await request(app)
      .post(`/api/v1/wallet/${endpoint}`)
      .set("Authorization", `Bearer ${token}`)
      .send(createBody([issuedAsset]))
      .expect(200);

    expect(response.body.successful).toBe(true);
    expect(serviceMethod).toHaveBeenCalledWith(
      expect.objectContaining({ path: [issuedAsset] })
    );
  });
});
