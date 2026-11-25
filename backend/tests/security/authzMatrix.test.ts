/**
 * Exhaustive route authorization matrix security test suite (#233).
 *
 * 1. Introspects the live Express router tree (`createApp()`) and FAILS CI
 *    if any mounted route is missing from `ROUTE_AUTHZ_POLICY` (unclassified
 *    route gate) or if a policy entry is stale.
 * 2. Executes EVERY mounted route against ALL caller classes:
 *      - `anon`           (no credentials)
 *      - `otherAccount`   (valid SEP-10 JWT for BOB targeting ALICE's resource)
 *      - `ownAccount`     (valid SEP-10 JWT for ALICE targeting ALICE's resource)
 *      - `apiKeyHeader`   (raw `x-api-key` header, no Bearer token — must be
 *                          rejected on every JWT route per #40)
 *      - `apiKeyJwt`      (Bearer JWT issued via `POST /auth/login` with
 *                          `sub: "api-key-user"`)
 * 3. Asserts every IDOR-sensitive route enforces cross-account rejection
 *    (403 `ACCOUNT_MISMATCH` / `FORBIDDEN` or 404 resource isolation) and
 *    uses the shared `{ error: { code, message } }` error envelope.
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import request from "supertest";

// Pre-build stable identities before jest.mock factories execute.
const ALICE = StellarSdk.Keypair.random();
const BOB = StellarSdk.Keypair.random();
const ISSUER = StellarSdk.Keypair.random();
const ALICE_DEVICE_ID = "101";
const ALICE_PENDING_TX_ID = "202";
const ALICE_EMAIL_TOKEN = "a".repeat(64);
const SAMPLE_TX_HASH = "b".repeat(64);

const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const SOROBAN_NETWORK_PASSPHRASE =
  process.env.SOROBAN_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

function buildSignedPaymentXdr(source: StellarSdk.Keypair, passphrase: string): string {
  const tx = new StellarSdk.TransactionBuilder(new StellarSdk.Account(source.publicKey(), "10"), {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: passphrase,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: ISSUER.publicKey(),
        asset: StellarSdk.Asset.native(),
        amount: "1",
      })
    )
    .setTimeout(300)
    .build();
  tx.sign(source);
  return tx.toXDR();
}

const ALICE_SIGNED_PAYMENT_XDR = buildSignedPaymentXdr(ALICE, NETWORK_PASSPHRASE);
const ALICE_SIGNED_SOROBAN_XDR = buildSignedPaymentXdr(ALICE, SOROBAN_NETWORK_PASSPHRASE);

// Mock persistence/Redis dependencies so the matrix exercises the real Express
// routing, auth, account-scoping, and validation middleware deterministically
// with zero live Postgres/Redis/Horizon/RPC sockets.
jest.mock("../../src/db", () => {
  const query = jest.fn(async (sql: string, params?: unknown[]) => {
    const normalized = sql.trim().toUpperCase();
    // SELECT 1 health check
    if (normalized === "SELECT 1") return { rows: [{ "?column?": 1 }] };
    // pending_txs lookup by id
    if (normalized.includes("FROM PENDING_TXS") && normalized.includes("WHERE ID =")) {
      const id = String(params?.[0] ?? "");
      if (id === ALICE_PENDING_TX_ID) {
        return {
          rows: [
            {
              id: ALICE_PENDING_TX_ID,
              account: ALICE.publicKey(),
              xdr: ALICE_SIGNED_PAYMENT_XDR,
              required_weight: 1,
              collected_signers: [ALICE.publicKey()],
              created_by: ALICE.publicKey(),
              expires_at: new Date(Date.now() + 300_000),
              status: "pending",
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        };
      }
      return { rows: [] };
    }
    if (normalized.includes("INSERT INTO PENDING_TXS")) {
      return {
        rows: [
          {
            id: ALICE_PENDING_TX_ID,
            account: ALICE.publicKey(),
            xdr: ALICE_SIGNED_PAYMENT_XDR,
            required_weight: 1,
            collected_signers: [ALICE.publicKey()],
            created_by: ALICE.publicKey(),
            expires_at: new Date(Date.now() + 300_000),
            status: "ready",
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      };
    }
    if (normalized.includes("UPDATE PENDING_TXS")) {
      return {
        rows: [
          {
            id: ALICE_PENDING_TX_ID,
            account: ALICE.publicKey(),
            xdr: ALICE_SIGNED_PAYMENT_XDR,
            required_weight: 1,
            collected_signers: [ALICE.publicKey()],
            created_by: ALICE.publicKey(),
            expires_at: new Date(Date.now() + 300_000),
            status: String(params?.[2] ?? "ready"),
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      };
    }
    if (normalized.includes("FROM PENDING_TXS")) {
      return { rows: [] };
    }
    // devices table — strictly enforce WHERE id = $1 AND account = $2
    if (normalized.includes("DELETE FROM DEVICES")) {
      const id = String(params?.[0] ?? "");
      const account = String(params?.[1] ?? "");
      if (id === ALICE_DEVICE_ID && account === ALICE.publicKey()) {
        return { rows: [{ id: ALICE_DEVICE_ID }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (normalized.includes("INSERT INTO DEVICES")) {
      return {
        rows: [
          {
            id: ALICE_DEVICE_ID,
            account: String(params?.[0] ?? ALICE.publicKey()),
            platform: String(params?.[1] ?? "expo"),
            token: String(params?.[2] ?? "ExponentPushToken[test]"),
            locale: String(params?.[3] ?? "en"),
            created_at: new Date(),
            last_seen_at: new Date(),
            expires_at: null,
          },
        ],
      };
    }
    if (normalized.includes("FROM DEVICES")) {
      return { rows: [] };
    }
    // verified_emails table — ALICE owns ALICE_EMAIL_TOKEN
    if (normalized.includes("FROM VERIFIED_EMAILS") && normalized.includes("WHERE TOKEN =")) {
      const token = String(params?.[0] ?? "");
      if (token === ALICE_EMAIL_TOKEN) {
        return {
          rows: [
            {
              account: ALICE.publicKey(),
              email: "alice@example.com",
              verified: false,
              token_expires_at: new Date(Date.now() + 60_000),
            },
          ],
        };
      }
      return { rows: [] };
    }
    if (normalized.includes("FROM VERIFIED_EMAILS")) {
      return { rows: [] };
    }
    if (normalized.includes("USER_PREFERENCES")) {
      return { rows: [{ preferences: { currency: "USD" } }] };
    }
    if (normalized.includes("FROM AUDIT_LOG")) {
      return { rows: [] };
    }
    return { rows: [], rowCount: 0 };
  });
  return { pool: { query } };
});

jest.mock("../../src/services/sessionStore", () => ({
  sessionStore: {
    isSessionRevoked: jest.fn().mockResolvedValue(false),
  },
}));

jest.mock("../../src/services/idempotency", () => ({
  requestFingerprint: jest.fn(() => "fp-test"),
  claimIdempotencyKey: jest.fn(async () => ({ status: "claimed" })),
  commitIdempotencyResult: jest.fn(async () => undefined),
  releaseIdempotencyKey: jest.fn(async () => undefined),
  getCachedResult: jest.fn(async () => null),
  cacheResult: jest.fn(async () => undefined),
}));

jest.mock("../../src/services/auditLog", () => ({
  logKeypairIssuance: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../src/services/activityFeed", () => ({
  getUnifiedActivityFeed: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
}));

jest.mock("../../src/services/transactionExport", () => ({
  MAX_EXPORT_RANGE_MS: 366 * 24 * 60 * 60 * 1000,
  streamTransactionCsv: jest.fn(async (res: import("express").Response) => {
    res.setHeader("Content-Type", "text/csv");
    res.status(200).send("timestamp,type,amount\n");
  }),
}));

jest.mock("../../src/services/feeSponsorship", () => ({
  sponsorFeeBump: jest.fn(async () => ({ hash: SAMPLE_TX_HASH, successful: true })),
  ensureFeeSponsorshipTable: jest.fn(),
}));

jest.mock("../../src/utils/jwt", () => {
  const actual = jest.requireActual("../../src/utils/jwt");
  return {
    ...actual,
    generateRefreshToken: jest.fn(async () => "mock-refresh-token"),
    generateTokenPair: jest.fn(async (sub: string) => ({
      accessToken: actual.generateAccessToken(sub),
      refreshToken: "mock-refresh-token",
      sessionId: "mock-session",
    })),
    rotateRefreshToken: jest.fn(async () => null),
    revokeRefreshToken: jest.fn(async () => undefined),
  };
});

jest.mock("../../src/services/emailNotifier", () => ({
  getEmailProvider: () => ({ send: jest.fn().mockResolvedValue(undefined) }),
}));

jest.mock("../../src/services/federation", () => ({
  isResolvableAddress: jest.requireActual("../../src/services/federation").isResolvableAddress,
  FederationService: jest.fn().mockImplementation(() => ({
    resolveAddress: jest.fn().mockResolvedValue({
      query: ALICE.publicKey(),
      type: "account",
      accountId: ALICE.publicKey(),
    }),
  })),
}));

jest.mock("../../src/services/assetSearch", () => ({
  DEFAULT_SEARCH_LIMIT: 20,
  MAX_SEARCH_LIMIT: 100,
  AssetSearchService: jest.fn().mockImplementation(() => ({
    searchByCode: jest.fn().mockResolvedValue({ results: [], nextCursor: null }),
    searchByDomain: jest.fn().mockResolvedValue({ results: [], nextCursor: null }),
  })),
}));

jest.mock("../../src/services/assetMetadata", () => ({
  AssetMetadataService: jest.fn().mockImplementation(() => ({
    getMetadata: jest.fn().mockResolvedValue({ code: "USDC", issuer: ISSUER.publicKey() }),
  })),
}));

import { createApp } from "../../src/app";
import { StellarService } from "../../src/services/stellar";
import { GlobeWalletContract } from "../../src/services/contracts/globeWallet";
import { generateAccessToken } from "../../src/utils/jwt";
import { parseSignedTransaction } from "../../src/services/transactionEnvelope";
import { isErrorCode } from "../../src/errors/codes";
import { enumerateAppRoutes } from "./routeEnumerator";
import { AuthzTestContext, ROUTE_AUTHZ_MAP, ROUTE_AUTHZ_POLICY, RouteAuthzEntry } from "./authzPolicy";

function createMockStellar(): StellarService {
  const fakeAccount = {
    account_id: ALICE.publicKey(),
    sequence: "100",
    subentry_count: 0,
    thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
    signers: [{ key: ALICE.publicKey(), weight: 1, type: "ed25519_public_key" }],
    balances: [{ asset_type: "native", balance: "100.0000000" }],
    sequenceNumber: () => "100",
    accountId: () => ALICE.publicKey(),
    incrementSequenceNumber: () => undefined,
  };

  return {
    generateKeypair: jest.fn(() => StellarSdk.Keypair.random()),
    getAccount: jest.fn(async () => fakeAccount),
    getBalances: jest.fn(async () => ({ XLM: "100.0000000" })),
    getTransactions: jest.fn(async () => ({ transactions: [], next: undefined, hasMore: false })),
    getPaymentHistory: jest.fn(async () => ({ payments: [], next: undefined, hasMore: false })),
    getTransactionDetail: jest.fn(async () => ({ hash: SAMPLE_TX_HASH, successful: true })),
    getAccountThresholds: jest.fn(async (pk: string) => ({
      lowThreshold: 1,
      mediumThreshold: 1,
      highThreshold: 1,
      // Only ALICE is an on-chain signer of ALICE's account; BOB and api-key-user are not.
      signers: [{ key: pk, weight: 1 }],
    })),
    buildTrustlineTransaction: jest.fn(async () => ({
      xdr: "AAAA",
      networkPassphrase: NETWORK_PASSPHRASE,
      reserveDelta: "0.5",
      spendableXlmAfter: "98.0000000",
    })),
    buildPayment: jest.fn(async () => ({
      xdr: "AAAA",
      networkPassphrase: NETWORK_PASSPHRASE,
      fee: "100",
      sequence: "101",
      timeBounds: { minTime: "0", maxTime: "9999999999" },
      expiresAt: "2286-11-20T17:46:39.000Z",
      operationType: "payment",
    })),
    buildPathPaymentStrictSend: jest.fn(async () => ({
      xdr: "AAAA",
      networkPassphrase: NETWORK_PASSPHRASE,
      fee: "100",
      sequence: "101",
      timeBounds: { minTime: "0", maxTime: "9999999999" },
      expiresAt: "2286-11-20T17:46:39.000Z",
      expectedSend: "10.0000000",
      expectedReceive: "10.0000000",
      minReceive: "9.9500000",
      slippageBps: 50,
      path: [],
    })),
    buildPathPaymentStrictReceive: jest.fn(async () => ({
      xdr: "AAAA",
      networkPassphrase: NETWORK_PASSPHRASE,
      fee: "100",
      sequence: "101",
      timeBounds: { minTime: "0", maxTime: "9999999999" },
      expiresAt: "2286-11-20T17:46:39.000Z",
      expectedSend: "10.0000000",
      expectedReceive: "10.0000000",
      maxSend: "10.0500000",
      slippageBps: 50,
      path: [],
    })),
    parseSignedTransaction: jest.fn((signedXdr: string) =>
      parseSignedTransaction(signedXdr, NETWORK_PASSPHRASE)
    ),
    submitSigned: jest.fn(async () => ({ hash: SAMPLE_TX_HASH, ledger: 100, successful: true })),
    sendPayment: jest.fn(async () => ({ hash: SAMPLE_TX_HASH, successful: true })),
    precheckSend: jest.fn(async () => ({
      warnings: [],
      blocking: false,
      operationType: "payment",
      spendable: "98.0000000",
    })),
    feeBumpTransaction: jest.fn(async () => ({ hash: SAMPLE_TX_HASH, successful: true })),
    pathPaymentStrictSend: jest.fn(async () => ({ hash: SAMPLE_TX_HASH, successful: true })),
    pathPaymentStrictReceive: jest.fn(async () => ({ hash: SAMPLE_TX_HASH, successful: true })),
    buildPartialTransaction: jest.fn(async () => ({ xdr: "AAAA" })),
    findStrictSendPaths: jest.fn(async () => []),
    findStrictReceivePaths: jest.fn(async () => []),
    submitWithAdditionalSignatures: jest.fn(async () => ({ hash: SAMPLE_TX_HASH, successful: true })),
  } as unknown as StellarService;
}

function createMockGlobeWallet(): GlobeWalletContract {
  const prepared = {
    xdr: "AAAA",
    networkPassphrase: SOROBAN_NETWORK_PASSPHRASE,
    fee: "1000",
    sequence: "101",
    timeBounds: { minTime: "0", maxTime: "9999999999" },
    expiresAt: "2286-11-20T17:46:39.000Z",
    minResourceFee: "900",
    authEntries: [],
    latestLedger: 50,
  };
  return {
    getAssets: jest.fn(async () => [{ code: "XLM", issuer: null }]),
    getSpendAllowances: jest.fn(async () => []),
    getSpendAllowance: jest.fn(async () => ({
      assetCode: "XLM",
      unlimited: true,
      limit: "0",
      spent: "0",
      remaining: null,
      windowStartsAt: new Date().toISOString(),
      windowResetsAt: new Date().toISOString(),
      nextRefillAt: null,
    })),
    getGuardians: jest.fn(async () => []),
    getRecoveryConfig: jest.fn(async () => null),
    getRecoveryProposal: jest.fn(async () => null),
    getRecoveryState: jest.fn(async () => ({
      guardians: [],
      guardianCount: 0,
      config: null,
      configured: false,
      proposal: null,
    })),
    getContractStatus: jest.fn(async () => ({ sendsPaused: false, pauser: null })),
    getAdminState: jest.fn(async () => ({ admin: ALICE.publicKey(), pendingAdmin: null })),
    getPendingUpgrade: jest.fn(async () => null),
    buildAddAssetTx: jest.fn(async () => "AAAA"),
    buildRemoveAssetTx: jest.fn(async () => "AAAA"),
    buildAddGuardianTx: jest.fn(async () => prepared),
    buildRemoveGuardianTx: jest.fn(async () => prepared),
    buildInitiateRecoveryTx: jest.fn(async () => prepared),
    buildApproveRecoveryTx: jest.fn(async () => prepared),
    buildRevokeRecoveryApprovalTx: jest.fn(async () => prepared),
    buildExecuteRecoveryTx: jest.fn(async () => prepared),
    buildCancelRecoveryTx: jest.fn(async () => prepared),
    buildSetSpendLimitTx: jest.fn(async () => prepared),
    buildProposeAdminTx: jest.fn(async () => "AAAA"),
    buildAcceptAdminTx: jest.fn(async () => "AAAA"),
    buildCancelAdminTransferTx: jest.fn(async () => "AAAA"),
    recordSpend: jest.fn(async () => ({ result: null, hash: SAMPLE_TX_HASH, ledger: 50 })),
    buildRecordSpend: jest.fn(async () => prepared),
    submitSigned: jest.fn(async () => ({ hash: SAMPLE_TX_HASH, ledger: 50, successful: true })),
  } as unknown as GlobeWalletContract;
}

function createMockPrices() {
  return {
    prices: {
      getPrice: jest.fn(async () => ({ asset: "XLM", priceUsd: "0.10", stale: false })),
      getPrices: jest.fn(async () => [{ asset: "XLM", priceUsd: "0.10", stale: false }]),
    } as never,
    history: {
      getHistory: jest.fn(async () => ({ asset: "XLM", range: "7d", points: [] })),
    } as never,
  };
}

function buildTestApp() {
  return createApp(createMockStellar(), createMockGlobeWallet(), createMockPrices(), {
    disableHealthCache: true,
    healthCheckDeps: {
      checkPostgres: async () => undefined,
      lockBackend: "in-process",
    },
  });
}

const TEST_CTX: AuthzTestContext = {
  alice: ALICE,
  bob: BOB,
  issuer: ISSUER,
  aliceSignedPaymentXdr: ALICE_SIGNED_PAYMENT_XDR,
  aliceSignedSorobanXdr: ALICE_SIGNED_SOROBAN_XDR,
  alicePendingTxId: ALICE_PENDING_TX_ID,
  aliceDeviceId: ALICE_DEVICE_ID,
  aliceEmailToken: ALICE_EMAIL_TOKEN,
  sampleTxHash: SAMPLE_TX_HASH,
};

type CallerKind = "anon" | "otherAccount" | "ownAccount" | "apiKeyHeader" | "apiKeyJwt";

let ipCounter = 1;
function nextForwardedIp(): string {
  const octet3 = Math.floor(ipCounter / 250) % 250;
  const octet4 = (ipCounter % 250) + 1;
  ipCounter += 1;
  return `198.51.${octet3}.${octet4}`;
}

function assertSharedErrorEnvelope(res: request.Response): void {
  expect(res.body).toHaveProperty("error");
  expect(typeof res.body.error).toBe("object");
  expect(typeof res.body.error.code).toBe("string");
  expect(isErrorCode(res.body.error.code)).toBe(true);
  expect(typeof res.body.error.message).toBe("string");
  expect(res.body.error.message.length).toBeGreaterThan(0);
}

async function sendAs(
  app: import("express").Express,
  entry: RouteAuthzEntry,
  caller: CallerKind,
  tokens: { aliceJwt: string; bobJwt: string; apiKeyJwt: string; apiKey: string }
): Promise<request.Response> {
  const spec = entry.buildRequest(TEST_CTX);
  const method = entry.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
  let req = request(app)[method](spec.path).set("X-Forwarded-For", nextForwardedIp());

  if (spec.query) {
    req = req.query(spec.query);
  }

  switch (caller) {
    case "anon":
      break;
    case "otherAccount":
      req = req.set("Authorization", `Bearer ${tokens.bobJwt}`);
      break;
    case "ownAccount":
      req = req.set("Authorization", `Bearer ${tokens.aliceJwt}`);
      break;
    case "apiKeyHeader":
      req = req.set("x-api-key", tokens.apiKey);
      break;
    case "apiKeyJwt":
      req = req.set("Authorization", `Bearer ${tokens.apiKeyJwt}`);
      break;
  }

  if (spec.body !== undefined) {
    req = req.send(spec.body);
  }
  return req;
}

describe("Security Authz Matrix — CI Exhaustiveness & Cross-Account Protection (#233)", () => {
  let app: import("express").Express;
  let tokens: { aliceJwt: string; bobJwt: string; apiKeyJwt: string; apiKey: string };

  beforeAll(() => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    // Stub global fetch so public routes that reach out (health details, dev/fund, network/fees)
    // respond quickly without making external network calls.
    jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: { status: "healthy" } }),
      text: async () => "ok",
    } as Response);

    app = buildTestApp();
    tokens = {
      aliceJwt: generateAccessToken(ALICE.publicKey(), "sep10"),
      bobJwt: generateAccessToken(BOB.publicKey(), "sep10"),
      apiKeyJwt: generateAccessToken("api-key-user", "api-key"),
      apiKey: process.env.API_KEY ?? "test-api-key",
    };
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe("Router exhaustiveness gate (fail CI on unclassified routes)", () => {
    it("classifies EVERY route mounted in createApp() with zero unclassified or stale entries", () => {
      const mounted = enumerateAppRoutes(app);
      const mountedKeys = new Set(mounted.map((r) => r.key));
      const policyKeys = new Set(ROUTE_AUTHZ_POLICY.map((p) => `${p.method} ${p.path}`));

      const unclassified = [...mountedKeys].filter((k) => !policyKeys.has(k)).sort();
      const stale = [...policyKeys].filter((k) => !mountedKeys.has(k)).sort();

      expect(unclassified).toEqual([]);
      expect(stale).toEqual([]);
      // Guard against accidental empty enumeration.
      expect(mounted.length).toBeGreaterThanOrEqual(70);
    });

    it("has no duplicate entries in ROUTE_AUTHZ_POLICY", () => {
      expect(ROUTE_AUTHZ_MAP.size).toBe(ROUTE_AUTHZ_POLICY.length);
    });
  });

  describe.each(ROUTE_AUTHZ_POLICY.map((entry) => [`${entry.method} ${entry.path} [${entry.authzClass}]`, entry] as const))(
    "%s",
    (_label, entry) => {
      it("anon: enforces expected unauthenticated policy", async () => {
        const res = await sendAs(app, entry, "anon", tokens);

        if (entry.authzClass === "public") {
          // Public routes must never block unauthenticated callers with 403;
          // credential-exchange public routes (/auth/token, /auth/refresh) return 401
          // for invalid credentials in the body, not missing Bearer header.
          if (entry.path !== "/api/v1/auth/token" && entry.path !== "/api/v1/auth/refresh") {
            expect(res.status).not.toBe(401);
          }
          expect(res.status).not.toBe(403);
        } else {
          expect(res.status).toBe(401);
          assertSharedErrorEnvelope(res);
        }
      });

      it("otherAccount (BOB -> ALICE): rejects cross-account access where scoped", async () => {
        const res = await sendAs(app, entry, "otherAccount", tokens);

        switch (entry.authzClass) {
          case "public":
            if (entry.path !== "/api/v1/auth/token" && entry.path !== "/api/v1/auth/refresh") {
              expect(res.status).not.toBe(401);
            }
            expect(res.status).not.toBe(403);
            break;

          case "login-api-key":
          case "admin-api-key":
            // Bearer JWT must NOT satisfy requireLoginApiKey.
            expect(res.status).toBe(401);
            assertSharedErrorEnvelope(res);
            expect(res.body.error.code).toBe("API_KEY_UNAUTHORIZED");
            break;

          case "authenticated-account-scoped":
            expect(res.status).toBe(403);
            assertSharedErrorEnvelope(res);
            expect(res.body.error.code).toBe("ACCOUNT_MISMATCH");
            break;

          case "authenticated-signer-scoped":
            expect(res.status).toBe(403);
            assertSharedErrorEnvelope(res);
            expect(res.body.error.code).toBe("FORBIDDEN");
            break;

          case "authenticated-self":
            if (entry.otherAccountExpectedStatuses) {
              expect(entry.otherAccountExpectedStatuses).toContain(res.status);
              assertSharedErrorEnvelope(res);
            } else {
              // Collection/self endpoints operate solely on BOB's own namespace (never ALICE's).
              expect(res.status).not.toBe(401);
              expect(res.status).not.toBe(403);
            }
            break;

          case "authenticated-unscoped":
            expect(res.status).not.toBe(401);
            expect(res.status).not.toBe(403);
            break;
        }
      });

      it("ownAccount (ALICE -> ALICE): passes authorization for owned resources", async () => {
        const res = await sendAs(app, entry, "ownAccount", tokens);

        if (entry.authzClass === "login-api-key" || entry.authzClass === "admin-api-key") {
          expect(res.status).toBe(401);
          assertSharedErrorEnvelope(res);
          expect(res.body.error.code).toBe("API_KEY_UNAUTHORIZED");
          return;
        }

        if (entry.path !== "/api/v1/auth/token" && entry.path !== "/api/v1/auth/refresh") {
          expect(res.status).not.toBe(401);
        }
        expect(res.status).not.toBe(403);
      });

      it("apiKeyHeader (raw x-api-key): accepted ONLY on login/admin routes, rejected on all JWT routes", async () => {
        const res = await sendAs(app, entry, "apiKeyHeader", tokens);

        if (entry.authzClass === "public") {
          if (entry.path !== "/api/v1/auth/token" && entry.path !== "/api/v1/auth/refresh") {
            expect(res.status).not.toBe(401);
          }
          expect(res.status).not.toBe(403);
          return;
        }

        if (entry.authzClass === "login-api-key" || entry.authzClass === "admin-api-key") {
          // Valid x-api-key passes auth gate (note: rotate-jwt-keys may hit mocked DB, must not be 401/403).
          expect(res.status).not.toBe(401);
          expect(res.status).not.toBe(403);
          return;
        }

        // All JWT-protected routes MUST reject raw x-api-key (#40).
        expect(res.status).toBe(401);
        assertSharedErrorEnvelope(res);
        expect(res.body.error.code).toBe("AUTH_HEADER_INVALID");
      });

      it("apiKeyJwt (Bearer sub=api-key-user): obeys legacy shared-identity scoping rules", async () => {
        const res = await sendAs(app, entry, "apiKeyJwt", tokens);

        switch (entry.authzClass) {
          case "public":
            if (entry.path !== "/api/v1/auth/token" && entry.path !== "/api/v1/auth/refresh") {
              expect(res.status).not.toBe(401);
            }
            expect(res.status).not.toBe(403);
            break;

          case "login-api-key":
          case "admin-api-key":
            expect(res.status).toBe(401);
            assertSharedErrorEnvelope(res);
            expect(res.body.error.code).toBe("API_KEY_UNAUTHORIZED");
            break;

          case "authenticated-signer-scoped":
            // "api-key-user" is never an on-chain Ed25519 signer of ALICE's account.
            expect(res.status).toBe(403);
            assertSharedErrorEnvelope(res);
            expect(res.body.error.code).toBe("FORBIDDEN");
            break;

          case "authenticated-account-scoped":
          case "authenticated-self":
          case "authenticated-unscoped":
            expect(res.status).not.toBe(401);
            expect(res.status).not.toBe(403);
            break;
        }
      });
    }
  );
});
