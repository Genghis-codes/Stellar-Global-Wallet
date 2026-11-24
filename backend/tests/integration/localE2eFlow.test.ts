/**
 * Hermetic in-process E2E harness verification (#232).
 *
 * Runs as part of standard `npm test` (no Docker or external network needed)
 * by spinning up a real loopback HTTP Horizon + Soroban RPC server on
 * `127.0.0.1:0` and booting the real Express `createApp()` on `127.0.0.1:0`,
 * then driving the real `@globe-wallet/sdk` `ApiClient` over real TCP/HTTP
 * through:
 *   1. Non-custodial Send (precheck -> build -> local sign -> submit -> idempotent replay)
 *   2. Spend-limit build + over-limit rejection (`SPEND_LIMIT_EXCEEDED`)
 *   3. Social recovery lifecycle (initiate -> approve -> execute -> cancel)
 *   4. Cross-account IDOR rejection over SDK `ApiClient`
 *   5. Failure artifact generation and automatic secret/JWT redaction
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import * as StellarSdk from "@stellar/stellar-sdk";
import { InMemoryTokenStore, createClient } from "@globe-wallet/sdk";

// In-memory idempotency store so submit + replay exercises atomic claim/commit.
jest.mock("../../src/services/idempotency", () => {
  const actual = jest.requireActual("../../src/services/idempotency");
  const rows = new Map<
    string,
    { fingerprint: string; hash: string; successful: boolean; committed: boolean }
  >();
  return {
    ...actual,
    claimIdempotencyKey: jest.fn(async (src: string, key: string, fp: string) => {
      const k = `${src}:${key}`;
      const existing = rows.get(k);
      if (!existing) {
        rows.set(k, { fingerprint: fp, hash: "", successful: false, committed: false });
        return { status: "claimed" };
      }
      if (existing.fingerprint !== fp) return { status: "conflict" };
      if (!existing.committed) return { status: "in-flight" };
      return { status: "hit", result: { hash: existing.hash, successful: existing.successful } };
    }),
    commitIdempotencyResult: jest.fn(
      async (src: string, key: string, fp: string, hash: string, successful: boolean) => {
        rows.set(`${src}:${key}`, { fingerprint: fp, hash, successful, committed: true });
      }
    ),
    releaseIdempotencyKey: jest.fn(async (src: string, key: string) => {
      const k = `${src}:${key}`;
      const existing = rows.get(k);
      if (existing && !existing.committed) rows.delete(k);
    }),
  };
});

jest.mock("../../src/services/sorobanCache", () => ({
  getCachedSimulate: jest.fn(async () => null),
  setCachedSimulate: jest.fn(async () => undefined),
  markPendingTransaction: jest.fn(async () => undefined),
  clearPendingTransaction: jest.fn(async () => undefined),
}));

jest.mock("../../src/services/sessionStore", () => ({
  sessionStore: { isSessionRevoked: jest.fn(async () => false) },
}));

import { createApp } from "../../src/app";
import { StellarService } from "../../src/services/stellar";
import { SorobanService } from "../../src/services/soroban";
import { GlobeWalletContract } from "../../src/services/contracts/globeWallet";
import {
  BuiltTransactionRegistry,
  InMemoryBuiltTransactionStore,
} from "../../src/services/builtTransactions";
import { InProcessAccountLock } from "../../src/services/locks/accountLock";
import { generateAccessToken } from "../../src/utils/jwt";
import { E2eArtifactRecorder, redactSecrets } from "../e2e/helpers/e2eArtifacts";

const PASSPHRASE = process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const CONTRACT_ID =
  process.env.GLOBE_WALLET_CONTRACT_ID ??
  "CBGLPMNSM4FWMIZ6FFBSRN7FNVCHCI2SLZNODA27LEOXFPLWNYEAEP3K";

interface FakeLedgerState {
  accounts: Map<string, { balanceXlm: number; sequence: bigint }>;
  horizonSubmissions: number;
  sorobanSubmissions: number;
  spendLimitStroops: bigint;
  spentStroops: bigint;
  recoveryApprovals: string[];
  recoveryNewAdmin: string | null;
  latestLedger: number;
}

function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function encodeScValBase64(val: StellarSdk.xdr.ScVal): string {
  return val.toXDR("base64");
}

function startLocalFakeStellarNode(state: FakeLedgerState, fallbackAccount: string): Promise<{
  server: http.Server;
  horizonUrl: string;
  rpcUrl: string;
}> {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      // Horizon root (health & networkCheck)
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ network_passphrase: PASSPHRASE, horizon_version: "local-fake" }));
        return;
      }

      // Horizon fee_stats
      if (req.method === "GET" && url.pathname === "/fee_stats") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            last_ledger_base_fee: "100",
            ledger_capacity_usage: "0.10",
            fee_charged: { p10: "100", p50: "100", p90: "200" },
          })
        );
        return;
      }

      // Horizon GET /accounts/:id
      const acctMatch = url.pathname.match(/^\/accounts\/(G[A-Z2-7]{55})$/);
      if (req.method === "GET" && acctMatch) {
        const id = acctMatch[1];
        const acct = state.accounts.get(id);
        if (!acct) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: 404, title: "Resource Missing" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            _links: {
              self: { href: `http://127.0.0.1/accounts/${id}` },
              data: { href: `http://127.0.0.1/accounts/${id}/data/{key}`, templated: true },
            },
            id,
            account_id: id,
            sequence: acct.sequence.toString(),
            subentry_count: 0,
            thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
            flags: { auth_required: false, auth_revocable: false, auth_immutable: false },
            balances: [{ asset_type: "native", balance: acct.balanceXlm.toFixed(7) }],
            signers: [{ key: id, weight: 1, type: "ed25519_public_key" }],
            data: {},
            data_attr: {},
          })
        );
        return;
      }

      // Horizon POST /transactions (submit classic tx)
      if (req.method === "POST" && url.pathname === "/transactions") {
        const raw = await readRequestBody(req);
        const params = new URLSearchParams(raw);
        const txXdr = params.get("tx") ?? "";
        const tx = StellarSdk.TransactionBuilder.fromXDR(txXdr, PASSPHRASE) as StellarSdk.Transaction;
        state.horizonSubmissions += 1;

        const src = state.accounts.get(tx.source);
        if (src) {
          src.sequence += 1n;
          const op = tx.operations[0];
          if (op.type === "payment") {
            const amt = Number(op.amount);
            src.balanceXlm -= amt;
            const dst = state.accounts.get(op.destination);
            if (dst) dst.balanceXlm += amt;
          }
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            hash: Buffer.from(tx.hash()).toString("hex"),
            ledger: ++state.latestLedger,
            successful: true,
          })
        );
        return;
      }

      // Soroban JSON-RPC endpoint
      if (req.method === "POST" && url.pathname === "/soroban/rpc") {
        const raw = await readRequestBody(req);
        const rpcReq = JSON.parse(raw) as { id: number; method: string; params?: Record<string, unknown> };

        const reply = (result: unknown) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: rpcReq.id, result }));
        };

        if (rpcReq.method === "getHealth") {
          reply({ status: "healthy", latestLedger: state.latestLedger });
          return;
        }
        if (rpcReq.method === "getLatestLedger") {
          reply({ id: "fake", protocolVersion: 21, sequence: state.latestLedger });
          return;
        }
        if (rpcReq.method === "getLedgerEntries") {
          const keys = (rpcReq.params?.keys as string[]) ?? [];
          const entries = keys.flatMap((keyB64) => {
            const lk = StellarSdk.xdr.LedgerKey.fromXDR(keyB64, "base64");
            // stellar-sdk 17 XDR: union arms and struct fields are properties.
            if (lk.type === "account" && lk.account.accountId.type === "publicKeyTypeEd25519") {
              const pk = StellarSdk.StrKey.encodeEd25519PublicKey(lk.account.accountId.ed25519.value);
              const acct = state.accounts.get(pk);
              if (!acct) return [];
              const accountEntry = new StellarSdk.xdr.AccountEntry({
                accountId: StellarSdk.Keypair.fromPublicKey(pk).xdrAccountId(),
                balance: 100000000000n,
                seqNum: acct.sequence,
                numSubEntries: 0,
                inflationDest: null,
                flags: 0,
                homeDomain: "",
                thresholds: Buffer.from([1, 1, 1, 1]),
                signers: [],
                ext: StellarSdk.xdr.AccountEntryExt.v0(),
              });
              const ledgerEntryData = StellarSdk.xdr.LedgerEntryData.account(accountEntry);
              return [
                {
                  key: keyB64,
                  xdr: ledgerEntryData.toXDR("base64"),
                  lastModifiedLedgerSeq: state.latestLedger,
                },
              ];
            }
            return [];
          });
          reply({ entries, latestLedger: state.latestLedger });
          return;
        }

        if (rpcReq.method === "simulateTransaction") {
          const txB64 = String(rpcReq.params?.transaction ?? "");
          const tx = StellarSdk.TransactionBuilder.fromXDR(txB64, PASSPHRASE) as StellarSdk.Transaction;
          const op = tx.operations[0] as StellarSdk.Operation.InvokeHostFunction;
          if (op.func.type !== "hostFunctionTypeInvokeContract") throw new Error("expected an invokeContract host function");
          const invoke = op.func.invokeContract;
          const fnName = invoke.functionName.toString();
          const args = invoke.args;

          if (fnName === "record_spend") {
            const amount = BigInt(StellarSdk.scValToNative(args[2]));
            if (state.spendLimitStroops > 0n && state.spentStroops + amount > state.spendLimitStroops) {
              reply({
                error: "HostError: Error(Contract, #1007) SpendLimitExceeded",
                latestLedger: state.latestLedger,
              });
              return;
            }
          }

          let retval: StellarSdk.xdr.ScVal = StellarSdk.xdr.ScVal.scvVoid();
          if (fnName === "recovery_proposal" && state.recoveryNewAdmin) {
            retval = StellarSdk.nativeToScVal({
              new_admin: state.recoveryNewAdmin,
              approvals: state.recoveryApprovals,
              ready_at: state.recoveryApprovals.length >= 2 ? state.latestLedger + 100 : null,
            });
          } else if (fnName === "recovery_config") {
            retval = StellarSdk.nativeToScVal({ threshold: 2, delay_in_ledgers: 17280 });
          }

          const emptyData = new StellarSdk.SorobanDataBuilder().build();
          reply({
            minResourceFee: "500",
            cost: { cpuInsns: "10000", memBytes: "4096" },
            transactionData: emptyData.toXDR("base64"),
            events: [],
            results: [{ auth: [], xdr: encodeScValBase64(retval) }],
            latestLedger: state.latestLedger,
          });
          return;
        }

        if (rpcReq.method === "sendTransaction") {
          const txB64 = String(rpcReq.params?.transaction ?? "");
          const tx = StellarSdk.TransactionBuilder.fromXDR(txB64, PASSPHRASE) as StellarSdk.Transaction;
          state.sorobanSubmissions += 1;
          const op = tx.operations[0] as StellarSdk.Operation.InvokeHostFunction;
          if (op.func.type !== "hostFunctionTypeInvokeContract") throw new Error("expected an invokeContract host function");
          const invoke = op.func.invokeContract;
          const fnName = invoke.functionName.toString();
          const args = invoke.args;
          if (fnName === "record_spend") {
            state.spentStroops += BigInt(StellarSdk.scValToNative(args[2]));
          } else if (fnName === "initiate_recovery") {
            state.recoveryNewAdmin = String(StellarSdk.scValToNative(args[1]));
            state.recoveryApprovals = [String(StellarSdk.scValToNative(args[0]))];
          } else if (fnName === "approve_recovery") {
            state.recoveryApprovals.push(String(StellarSdk.scValToNative(args[0])));
          } else if (fnName === "cancel_recovery") {
            state.recoveryNewAdmin = null;
            state.recoveryApprovals = [];
          }
          const src = state.accounts.get(tx.source);
          if (src) src.sequence += 1n;
          reply({
            status: "PENDING",
            hash: Buffer.from(tx.hash()).toString("hex"),
            latestLedger: ++state.latestLedger,
          });
          return;
        }

        if (rpcReq.method === "getTransaction") {
          const txHash = String(rpcReq.params?.hash ?? "a".repeat(64));
          const dummyTx = new StellarSdk.TransactionBuilder(
            new StellarSdk.Account(fallbackAccount, "1"),
            { fee: "100", networkPassphrase: PASSPHRASE }
          )
            .addOperation(StellarSdk.Operation.bumpSequence({ bumpTo: "2" }))
            .setTimeout(30)
            .build();
          const txResult = new StellarSdk.xdr.TransactionResult({
            feeCharged: StellarSdk.xdr.Int64.fromString("100"),
            result: StellarSdk.xdr.TransactionResultResult.txSuccess([]),
            ext: new StellarSdk.xdr.TransactionResultExt(0),
          });
          const txMeta = new StellarSdk.xdr.TransactionMeta(
            3,
            new StellarSdk.xdr.TransactionMetaV3({
              ext: new StellarSdk.xdr.ExtensionPoint(0),
              txChangesBefore: [],
              operations: [],
              txChangesAfter: [],
              sorobanMeta: new StellarSdk.xdr.SorobanTransactionMeta({
                ext: new StellarSdk.xdr.SorobanTransactionMetaExt(0),
                events: [],
                returnValue: StellarSdk.xdr.ScVal.scvVoid(),
                diagnosticEvents: [],
              }),
            })
          );
          reply({
            status: "SUCCESS",
            txHash,
            ledger: state.latestLedger,
            createdAt: Math.floor(Date.now() / 1000),
            applicationOrder: 1,
            feeBump: false,
            envelopeXdr: dummyTx.toEnvelope().toXDR("base64"),
            resultXdr: txResult.toXDR("base64"),
            resultMetaXdr: txMeta.toXDR("base64"),
            latestLedger: state.latestLedger,
            latestLedgerCloseTime: String(Math.floor(Date.now() / 1000)),
            oldestLedger: 1,
            oldestLedgerCloseTime: "0",
          });
          return;
        }

        reply({});
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("Failed to bind fake Stellar server");
      resolve({
        server,
        horizonUrl: `http://127.0.0.1:${addr.port}`,
        rpcUrl: `http://127.0.0.1:${addr.port}/soroban/rpc`,
      });
    });
  });
}

describe("Hermetic E2E harness (loopback Horizon/RPC + real Express + @globe-wallet/sdk) (#232)", () => {
  const owner = StellarSdk.Keypair.random();
  const recipient = StellarSdk.Keypair.random();
  const guardian1 = StellarSdk.Keypair.random();
  const guardian2 = StellarSdk.Keypair.random();
  const candidate = StellarSdk.Keypair.random();

  let state: FakeLedgerState;
  let fakeStellarServer: http.Server;
  let backendServer: http.Server;
  let apiBaseUrl: string;

  beforeAll(async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    state = {
      accounts: new Map([
        [owner.publicKey(), { balanceXlm: 500, sequence: 100n }],
        [recipient.publicKey(), { balanceXlm: 50, sequence: 10n }],
        [guardian1.publicKey(), { balanceXlm: 100, sequence: 10n }],
        [guardian2.publicKey(), { balanceXlm: 100, sequence: 10n }],
      ]),
      horizonSubmissions: 0,
      sorobanSubmissions: 0,
      spendLimitStroops: 50_000_000n, // 5 XLM
      spentStroops: 0n,
      recoveryApprovals: [],
      recoveryNewAdmin: null,
      latestLedger: 1000,
    };

    const fakeNode = await startLocalFakeStellarNode(state, owner.publicKey());
    fakeStellarServer = fakeNode.server;

    const builtTxs = new BuiltTransactionRegistry(
      new InMemoryBuiltTransactionStore(),
      PASSPHRASE
    );
    const stellar = new StellarService(new InProcessAccountLock(), builtTxs, {
      horizonUrl: fakeNode.horizonUrl,
      networkPassphrase: PASSPHRASE,
    });
    const soroban = new SorobanService({
      rpcUrl: fakeNode.rpcUrl,
      networkPassphrase: PASSPHRASE,
      pollIntervalMs: 10,
      pollTimeoutMs: 2_000,
    });
    const globeWallet = new GlobeWalletContract(soroban, CONTRACT_ID);
    const app = createApp(stellar, globeWallet, undefined, {
      disableHealthCache: true,
      healthCheckDeps: {
        horizonUrl: fakeNode.horizonUrl,
        sorobanRpcUrl: fakeNode.rpcUrl,
        checkPostgres: async () => undefined,
        lockBackend: "in-process",
      },
    });

    backendServer = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const addr = backendServer.address();
    if (!addr || typeof addr === "string") throw new Error("Failed to bind backend server");
    apiBaseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    backendServer.closeAllConnections?.();
    fakeStellarServer.closeAllConnections?.();
    await new Promise<void>((resolve) => backendServer.close(() => resolve()));
    await new Promise<void>((resolve) => fakeStellarServer.close(() => resolve()));
  });

  function sdkFor(kp: StellarSdk.Keypair) {
    const store = new InMemoryTokenStore();
    store.set({ accessToken: generateAccessToken(kp.publicKey(), "sep10") });
    return createClient({ baseUrl: apiBaseUrl, tokenStore: store, maxRetries: 1 });
  }

  function signLocally(xdr: string, kp: StellarSdk.Keypair): string {
    const tx = StellarSdk.TransactionBuilder.fromXDR(xdr, PASSPHRASE);
    tx.sign(kp);
    return tx.toXDR();
  }

  it("executes full non-custodial send -> idempotent replay -> balance check via SDK", async () => {
    const sdk = sdkFor(owner);

    const built = await sdk.request<{ xdr: string; networkPassphrase: string }>(
      "/api/v1/wallet/send/build",
      {
        method: "POST",
        body: {
          sourcePublicKey: owner.publicKey(),
          destinationPublicKey: recipient.publicKey(),
          amount: "25",
          memo: "hermetic-e2e",
        },
      }
    );
    const signedXdr = signLocally(built.xdr, owner);

    const first = await sdk.request<{ hash: string; successful: boolean }>("/api/v1/wallet/submit", {
      method: "POST",
      idempotencyKey: "hermetic-key-1",
      body: { signedXdr },
    });
    const replay = await sdk.request<{ hash: string; successful: boolean }>("/api/v1/wallet/submit", {
      method: "POST",
      idempotencyKey: "hermetic-key-1",
      body: { signedXdr },
    });

    expect(first.successful).toBe(true);
    expect(replay.hash).toBe(first.hash);
    expect(state.horizonSubmissions).toBe(1);

    const balances = await sdk.request<{ balances: Record<string, string> }>(
      `/api/v1/account/${recipient.publicKey()}/balances`
    );
    expect(Number(balances.balances.XLM)).toBeCloseTo(75, 5);
  });

  it("enforces spend-limit simulation rejection and full recovery workflow via SDK", async () => {
    const ownerSdk = sdkFor(owner);
    const g1Sdk = sdkFor(guardian1);
    const g2Sdk = sdkFor(guardian2);

    // 1. Spend within 5 XLM limit succeeds.
    const okSpend = await ownerSdk.request<{ xdr: string }>("/api/v1/contract/wallet/spend/build", {
      method: "POST",
      body: { userPublicKey: owner.publicKey(), assetCode: "XLM", amount: "30000000" },
    });
    const okSubmit = await ownerSdk.request<{ successful: boolean }>("/api/v1/contract/wallet/submit", {
      method: "POST",
      body: { signedXdr: signLocally(okSpend.xdr, owner) },
    });
    expect(okSubmit.successful).toBe(true);

    // 2. Spend exceeding remaining 2 XLM is rejected in simulation with SPEND_LIMIT_EXCEEDED (422).
    await expect(
      ownerSdk.request("/api/v1/contract/wallet/spend/build", {
        method: "POST",
        body: { userPublicKey: owner.publicKey(), assetCode: "XLM", amount: "30000000" },
      })
    ).rejects.toMatchObject({ status: 422, code: "SPEND_LIMIT_EXCEEDED" });

    // 3. Recovery flow: Guardian 1 initiates -> Guardian 2 approves -> Admin cancels.
    const initBuild = await g1Sdk.request<{ xdr: string }>(
      "/api/v1/contract/wallet/recovery/initiate/build",
      {
        method: "POST",
        body: { guardian: guardian1.publicKey(), newAdmin: candidate.publicKey() },
      }
    );
    await g1Sdk.request("/api/v1/contract/wallet/submit", {
      method: "POST",
      body: { signedXdr: signLocally(initBuild.xdr, guardian1) },
    });

    const approveBuild = await g2Sdk.request<{ xdr: string }>(
      "/api/v1/contract/wallet/recovery/approve/build",
      {
        method: "POST",
        body: { guardian: guardian2.publicKey() },
      }
    );
    await g2Sdk.request("/api/v1/contract/wallet/submit", {
      method: "POST",
      body: { signedXdr: signLocally(approveBuild.xdr, guardian2) },
    });

    const proposal = await ownerSdk.request<{
      proposal: { quorumReached: boolean; approvalsCount: number } | null;
    }>("/api/v1/contract/wallet/recovery/proposal");
    expect(proposal.proposal).toMatchObject({ quorumReached: true, approvalsCount: 2 });

    const cancelBuild = await ownerSdk.request<{ xdr: string }>(
      "/api/v1/contract/wallet/recovery/cancel/build",
      {
        method: "POST",
        body: { admin: owner.publicKey() },
      }
    );
    await ownerSdk.request("/api/v1/contract/wallet/submit", {
      method: "POST",
      body: { signedXdr: signLocally(cancelBuild.xdr, owner) },
    });

    const cleared = await ownerSdk.request<{ proposal: unknown | null }>(
      "/api/v1/contract/wallet/recovery/proposal"
    );
    expect(cleared.proposal).toBeNull();
  }, 15_000);

  it("writes redacted JSON and Markdown failure artifacts without leaking secret seeds or JWTs", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-e2e-artifacts-"));
    try {
      const recorder = new E2eArtifactRecorder("unit-check", tmpDir);
      const leakedSeed = owner.secret();
      const leakedJwt = generateAccessToken(owner.publicKey(), "sep10");

      recorder.record("send", `Signed with ${leakedSeed} and Bearer ${leakedJwt}`, {
        sourceSecretKey: leakedSeed,
        authorization: `Bearer ${leakedJwt}`,
        publicKey: owner.publicKey(),
      });

      const { jsonPath, mdPath } = recorder.writeFailureArtifact(
        "synthetic-failure",
        new Error(`boom ${leakedSeed}`)
      );

      const jsonRaw = fs.readFileSync(jsonPath, "utf8");
      const mdRaw = fs.readFileSync(mdPath, "utf8");

      expect(jsonRaw).not.toContain(leakedSeed);
      expect(jsonRaw).not.toContain(leakedJwt);
      expect(mdRaw).not.toContain(leakedSeed);
      expect(mdRaw).not.toContain(leakedJwt);
      expect(jsonRaw).toContain(owner.publicKey());
      expect(redactSecrets(leakedSeed)).toBe("[REDACTED_SECRET_SEED]");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
