import request from "supertest";
import { createApp } from "../../src/app";
import { StellarService } from "../../src/services/stellar";
import { GlobeWalletContract } from "../../src/services/contracts/globeWallet";
import {
  SorobanNotConfiguredError,
  SorobanSimulationError,
} from "../../src/services/sorobanErrors";

const VALID_PUBLIC_KEY = "GBLIQBXTAF3O3YINCRDR5O7H47QHHW5GFOYN4HAD6IKOSWD4LWKWWPHP";

function buildApp(globeWallet: Partial<GlobeWalletContract>) {
  const stellar = { generateKeypair: jest.fn() } as unknown as StellarService;
  return createApp(stellar, globeWallet as GlobeWalletContract);
}

async function getAccessToken(app: import("express").Express): Promise<string> {
  const login = await request(app).post("/api/v1/auth/login").set("x-api-key", "test-api-key");
  return login.body.accessToken;
}

describe("GET /api/v1/contract/wallet/:publicKey/assets", () => {
  it("returns decoded assets without requiring authentication (public on-chain read)", async () => {
    const getAssets = jest.fn().mockResolvedValue([{ code: "XLM", issuer: null }]);
    const app = buildApp({ getAssets });

    const res = await request(app)
      .get(`/api/v1/contract/wallet/${VALID_PUBLIC_KEY}/assets`)
      .expect(200);

    expect(res.body).toEqual({ assets: [{ code: "XLM", issuer: null }] });
    expect(getAssets).toHaveBeenCalledWith(VALID_PUBLIC_KEY);
  });

  it("rejects a malformed public key with 400 before calling the contract", async () => {
    const getAssets = jest.fn();
    const app = buildApp({ getAssets });

    await request(app).get("/api/v1/contract/wallet/not-a-key/assets").expect(400);
    expect(getAssets).not.toHaveBeenCalled();
  });

  it("maps a missing contract ID to 503, not a raw 500", async () => {
    const getAssets = jest.fn().mockRejectedValue(new SorobanNotConfiguredError());
    const app = buildApp({ getAssets });

    const res = await request(app)
      .get(`/api/v1/contract/wallet/${VALID_PUBLIC_KEY}/assets`)
      .expect(503);
    expect(res.body.error.code).toBe("SOROBAN_NOT_CONFIGURED");
  });
});

describe("POST /api/v1/contract/wallet/spend", () => {
  it("rejects an unauthenticated request", async () => {
    const app = buildApp({ recordSpend: jest.fn() });
    await request(app)
      .post("/api/v1/contract/wallet/spend")
      .send({ userSecretKey: "S".repeat(56), assetCode: "XLM", amount: "1000" })
      .expect(401);
  });

  it("invokes record_spend end-to-end for an authenticated caller and returns the tx hash", async () => {
    const recordSpend = jest.fn().mockResolvedValue({ result: null, hash: "deadbeef", ledger: 42 });
    const app = buildApp({ recordSpend });
    const accessToken = await getAccessToken(app);

    const res = await request(app)
      .post("/api/v1/contract/wallet/spend")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ userSecretKey: "S".repeat(56), assetCode: "XLM", amount: "1000" })
      .expect(200);

    expect(res.body).toEqual({ hash: "deadbeef", ledger: 42, successful: true });
    expect(recordSpend).toHaveBeenCalledWith({
      userSecretKey: "S".repeat(56),
      assetCode: "XLM",
      amount: "1000",
    });
  });

  it(
    "surfaces a simulation-caught rejection (e.g. spend-limit exceeded) as 422 " +
      "— proving the failure was caught before submission, not a server error",
    async () => {
      const recordSpend = jest
        .fn()
        .mockRejectedValue(new SorobanSimulationError("SpendLimitExceeded (contract error #1007)"));
      const app = buildApp({ recordSpend });
      const accessToken = await getAccessToken(app);

      const res = await request(app)
        .post("/api/v1/contract/wallet/spend")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ userSecretKey: "S".repeat(56), assetCode: "XLM", amount: "999999999" })
        .expect(422);

      expect(res.body.error.code).toBe("SOROBAN_SIMULATION_FAILED");
    }
  );

  it("rejects a missing amount with 400 before calling the contract", async () => {
    const recordSpend = jest.fn();
    const app = buildApp({ recordSpend });
    const accessToken = await getAccessToken(app);

    await request(app)
      .post("/api/v1/contract/wallet/spend")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ userSecretKey: "S".repeat(56), assetCode: "XLM" })
      .expect(400);
    expect(recordSpend).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/contract/admin (issue #80)", () => {
  it("returns current admin and null pending admin when no transfer is pending", async () => {
    const getAdminState = jest.fn().mockResolvedValue({
      admin: VALID_PUBLIC_KEY,
      pendingAdmin: null,
    });
    const app = buildApp({ getAdminState });

    const res = await request(app).get("/api/v1/contract/admin").expect(200);

    expect(res.body).toEqual({
      admin: VALID_PUBLIC_KEY,
      pendingAdmin: null,
    });
  });

  it("returns current and pending admin when transfer proposal exists", async () => {
    const candidate = "GA6HCMBLTZS5VYYBCATRBRZ3ACJRONEAZMYY5E43HAGXUTOUVCR5KVDT";
    const getAdminState = jest.fn().mockResolvedValue({
      admin: VALID_PUBLIC_KEY,
      pendingAdmin: candidate,
    });
    const app = buildApp({ getAdminState });

    const res = await request(app).get("/api/v1/contract/admin").expect(200);

    expect(res.body).toEqual({
      admin: VALID_PUBLIC_KEY,
      pendingAdmin: candidate,
    });
  });
});

describe("GET /api/v1/contract/upgrade (issue #81)", () => {
  it("returns null pending upgrade when none is queued", async () => {
    const getPendingUpgrade = jest.fn().mockResolvedValue(null);
    const app = buildApp({ getPendingUpgrade });

    const res = await request(app).get("/api/v1/contract/upgrade").expect(200);

    expect(res.body).toEqual({ pendingUpgrade: null });
  });

  it("returns pending upgrade information when queued", async () => {
    const upgradeData = {
      wasmHash: "aabbccdd",
      proposedBy: VALID_PUBLIC_KEY,
      readyAtLedger: 1000,
      executableAt: "2026-10-18T10:00:00.000Z",
    };
    const getPendingUpgrade = jest.fn().mockResolvedValue(upgradeData);
    const app = buildApp({ getPendingUpgrade });

    const res = await request(app).get("/api/v1/contract/upgrade").expect(200);

    expect(res.body).toEqual({ pendingUpgrade: upgradeData });
  });
});

describe("POST /api/v1/contract/admin/{propose,accept,cancel} unsigned XDR builders (issue #80)", () => {
  const candidate = "GA6HCMBLTZS5VYYBCATRBRZ3ACJRONEAZMYY5E43HAGXUTOUVCR5KVDT";

  it("builds unsigned XDR for propose admin", async () => {
    const buildProposeAdminTx = jest.fn().mockResolvedValue("AAAA_MOCK_PROPOSE_XDR");
    const app = buildApp({ buildProposeAdminTx });
    const accessToken = await getAccessToken(app);

    const res = await request(app)
      .post("/api/v1/contract/admin/propose")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ currentAdmin: VALID_PUBLIC_KEY, candidate })
      .expect(200);

    expect(res.body).toEqual({ xdr: "AAAA_MOCK_PROPOSE_XDR" });
    expect(buildProposeAdminTx).toHaveBeenCalledWith({
      currentAdmin: VALID_PUBLIC_KEY,
      candidate,
    });
  });

  it("builds unsigned XDR for accept admin", async () => {
    const buildAcceptAdminTx = jest.fn().mockResolvedValue("AAAA_MOCK_ACCEPT_XDR");
    const app = buildApp({ buildAcceptAdminTx });
    const accessToken = await getAccessToken(app);

    const res = await request(app)
      .post("/api/v1/contract/admin/accept")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ candidate })
      .expect(200);

    expect(res.body).toEqual({ xdr: "AAAA_MOCK_ACCEPT_XDR" });
    expect(buildAcceptAdminTx).toHaveBeenCalledWith({ candidate });
  });

  it("builds unsigned XDR for cancel admin transfer", async () => {
    const buildCancelAdminTransferTx = jest.fn().mockResolvedValue("AAAA_MOCK_CANCEL_XDR");
    const app = buildApp({ buildCancelAdminTransferTx });
    const accessToken = await getAccessToken(app);

    const res = await request(app)
      .post("/api/v1/contract/admin/cancel")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ currentAdmin: VALID_PUBLIC_KEY })
      .expect(200);

    expect(res.body).toEqual({ xdr: "AAAA_MOCK_CANCEL_XDR" });
    expect(buildCancelAdminTransferTx).toHaveBeenCalledWith({
      currentAdmin: VALID_PUBLIC_KEY,
    });
  });

  it("rejects invalid public key in propose admin with 400", async () => {
    const app = buildApp({});
    const accessToken = await getAccessToken(app);

    await request(app)
      .post("/api/v1/contract/admin/propose")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ currentAdmin: "invalid-key", candidate })
      .expect(400);
  });
});

