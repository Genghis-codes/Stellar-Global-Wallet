jest.mock("../../src/services/stellar", () => {
  return {
    StellarService: jest.fn().mockImplementation(() => ({
      getAccountThresholds: jest.fn().mockImplementation((publicKey: string) => {
        if (publicKey === "GBZH7QMRVYFLVYQRY6O5SOM3G7MSQF7MMUEM3WUOGRV26W3R3K5M7G8A") {
          return Promise.resolve({
            lowThreshold: 1,
            mediumThreshold: 2,
            highThreshold: 3,
            signers: [{ key: "GBZH7QMRVYFLVYQRY6O5SOM3G7MSQF7MMUEM3WUOGRV26W3R3K5M7G8A", weight: 1 }],
          });
        }
        return Promise.reject(new Error("Account not found"));
      }),
    })),
  };
});

jest.mock("../../src/services/auditLog", () => ({
  logKeypairIssuance: jest.fn().mockResolvedValue(undefined),
}));

import request from "supertest";
import { createApp } from "../../src/app";

const app = createApp();

describe("GET /api/v1/wallet/:publicKey/thresholds", () => {
  const G_ADDRESS = "GBZH7QMRVYFLVYQRY6O5SOM3G7MSQF7MMUEM3WUOGRV26W3R3K5M7G8A";
  const M_ADDRESS = "MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA7345A";
  const INVALID_KEY = "not-a-valid-key";

  let accessToken: string;

  beforeAll(async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .set("x-api-key", "test-api-key");
    accessToken = login.body.accessToken;
  });

  it("returns 401 unauthenticated if no Authorization header is provided", async () => {
    await request(app)
      .get(`/api/v1/wallet/${G_ADDRESS}/thresholds`)
      .expect(401);
  });

  it("returns 200 with account thresholds for a valid G... public key", async () => {
    const res = await request(app)
      .get(`/api/v1/wallet/${G_ADDRESS}/thresholds`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toEqual({
      lowThreshold: 1,
      mediumThreshold: 2,
      highThreshold: 3,
      signers: [{ key: G_ADDRESS, weight: 1 }],
    });
  });

  it("rejects an M... address with 400 validation error", async () => {
    const res = await request(app)
      .get(`/api/v1/wallet/${M_ADDRESS}/thresholds`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(400);

    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details[0].path).toBe("publicKey");
    expect(res.body.details[0].message).toContain("Muxed");
  });

  it("rejects a malformed public key with 400 validation error", async () => {
    const res = await request(app)
      .get(`/api/v1/wallet/${INVALID_KEY}/thresholds`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(400);

    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details[0].path).toBe("publicKey");
  });
});
