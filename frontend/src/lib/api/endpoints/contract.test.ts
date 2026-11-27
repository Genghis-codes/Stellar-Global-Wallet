import { describe, expect, it } from "vitest";
import { callHeaders, errorResponse, jsonResponse, mockFetch } from "@/test/fetch";
import { createApiClient } from "../client";
import { contractApi, type RecoveryState } from "./contract";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const GUARDIAN = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const BASE = "http://api.test/api/v1/contract";

const prepared = {
  xdr: "AAAA",
  networkPassphrase: "Test SDF Network ; September 2015",
  fee: "100",
  sequence: "1",
  timeBounds: { minTime: "0", maxTime: "0" },
  expiresAt: null,
  minResourceFee: "5000",
  authEntries: [],
  latestLedger: 100,
};

function setup(...responses: Response[]) {
  const fetch = mockFetch(...responses);
  const client = createApiClient({ baseUrl: "http://api.test", fetch });
  client.tokens.set({ accessToken: "access", refreshToken: "refresh", account: G });
  return { fetch, contract: contractApi(client) };
}

function body(fetch: ReturnType<typeof mockFetch>, index = 0) {
  return JSON.parse(String(fetch.mock.calls[index]![1]?.body));
}

describe("contractApi reads", () => {
  it("unwraps single-key envelopes", async () => {
    const recovery: RecoveryState = {
      guardians: [GUARDIAN],
      guardianCount: 1,
      config: { threshold: 1, delayInLedgers: 17280 },
      configured: true,
      proposal: null,
    };
    const { fetch, contract } = setup(
      jsonResponse({ assets: [{ code: "XLM", issuer: null }] }),
      jsonResponse({ allowances: [] }),
      jsonResponse({ guardians: [GUARDIAN] }),
      jsonResponse({ pendingUpgrade: null }),
      jsonResponse(recovery),
    );
    await expect(contract.assets(G)).resolves.toEqual([{ code: "XLM", issuer: null }]);
    await expect(contract.spendAllowances(G)).resolves.toEqual([]);
    await expect(contract.guardians()).resolves.toEqual([GUARDIAN]);
    await expect(contract.pendingUpgrade()).resolves.toBeNull();
    await expect(contract.recovery()).resolves.toEqual(recovery);
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      `${BASE}/wallet/${G}/assets`,
      `${BASE}/wallet/${G}/spend-allowance`,
      `${BASE}/wallet/guardians`,
      `${BASE}/upgrade`,
      `${BASE}/wallet/recovery`,
    ]);
  });

  it("does not send the session on public reads", async () => {
    const { fetch, contract } = setup(jsonResponse({ sendsPaused: false, pauser: null }));
    await contract.status();
    expect(callHeaders(fetch).Authorization).toBeUndefined();
  });

  it("reads one allowance by asset code", async () => {
    const { fetch, contract } = setup(jsonResponse({ assetCode: "USDC", unlimited: true }));
    await contract.spendAllowance(G, "USDC");
    expect(fetch.mock.calls[0]![0]).toBe(`${BASE}/wallet/${G}/spend-allowance/USDC`);
  });
});

describe("contractApi builds", () => {
  it("sends the spend limit as a decimal amount", async () => {
    const { fetch, contract } = setup(jsonResponse(prepared));
    await expect(contract.buildSetSpendLimit(G, "USDC", "250.5")).resolves.toEqual(prepared);
    expect(fetch.mock.calls[0]![0]).toBe(`${BASE}/wallet/spend-limit/build`);
    expect(body(fetch)).toEqual({ user: G, assetCode: "USDC", limit: "250.5" });
    expect(callHeaders(fetch).Authorization).toBe("Bearer access");
  });

  it("names the acting account in every build body", async () => {
    const { fetch, contract } = setup(...Array.from({ length: 9 }, () => jsonResponse(prepared)));
    await contract.buildAddGuardian(G, GUARDIAN);
    await contract.buildRemoveGuardian(G, GUARDIAN);
    await contract.buildInitiateRecovery(GUARDIAN, G);
    await contract.buildApproveRecovery(GUARDIAN);
    await contract.buildRevokeRecoveryApproval(GUARDIAN);
    await contract.buildExecuteRecovery(G);
    await contract.buildCancelRecovery(G);
    await contract.buildAddAsset(G, { code: "USDC", issuer: GUARDIAN });
    await contract.buildRemoveAsset(G, "USDC");
    expect(fetch.mock.calls.map((call) => String(call[0]).replace(BASE, ""))).toEqual([
      "/wallet/guardians/add/build",
      "/wallet/guardians/remove/build",
      "/wallet/recovery/initiate/build",
      "/wallet/recovery/approve/build",
      "/wallet/recovery/revoke-approval/build",
      "/wallet/recovery/execute/build",
      "/wallet/recovery/cancel/build",
      "/wallet/assets/build",
      "/wallet/assets/remove/build",
    ]);
    expect(body(fetch, 0)).toEqual({ admin: G, guardian: GUARDIAN });
    expect(body(fetch, 2)).toEqual({ guardian: GUARDIAN, newAdmin: G });
    expect(body(fetch, 5)).toEqual({ sourcePublicKey: G });
    expect(body(fetch, 7)).toEqual({ user: G, asset: { code: "USDC", issuer: GUARDIAN } });
    expect(body(fetch, 8)).toEqual({ user: G, assetCode: "USDC" });
  });

  it("builds admin transfer steps", async () => {
    const { fetch, contract } = setup(
      jsonResponse({ xdr: "P" }),
      jsonResponse({ xdr: "A" }),
      jsonResponse({ xdr: "C" }),
    );
    await expect(contract.buildProposeAdmin(G, GUARDIAN)).resolves.toEqual({ xdr: "P" });
    await contract.buildAcceptAdmin(GUARDIAN);
    await contract.buildCancelAdminTransfer(G);
    expect(body(fetch, 0)).toEqual({ currentAdmin: G, candidate: GUARDIAN });
    expect(body(fetch, 1)).toEqual({ candidate: GUARDIAN });
    expect(body(fetch, 2)).toEqual({ currentAdmin: G });
  });

  it("submits signed envelopes and keeps contract error codes", async () => {
    const { fetch, contract } = setup(
      jsonResponse({ hash: "h", status: "pending" }, { status: 202 }),
      errorResponse(400, "SPEND_LIMIT_EXCEEDED", "Spend limit exceeded"),
    );
    await expect(contract.submit("SIGNED")).resolves.toEqual({ hash: "h", status: "pending" });
    expect(fetch.mock.calls[0]![0]).toBe(`${BASE}/wallet/submit`);
    await expect(contract.submit("SIGNED")).rejects.toMatchObject({ code: "SPEND_LIMIT_EXCEEDED" });
  });
});
