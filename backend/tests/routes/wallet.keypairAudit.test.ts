jest.mock("../../src/services/stellar", () => {
  const mockKeypair = {
    publicKey: () => "GKEYPAIRAUDITTEST000000000000000000000000000000000000",
    secret: () => "SKEYPAIRAUDITTEST000000000000000000000000000000000000",
  };
  return {
    StellarService: jest.fn().mockImplementation(() => ({
      generateKeypair: () => mockKeypair,
      getAccount: jest.fn(),
      getBalances: jest.fn(),
      getTransactions: jest.fn(),
      sendPayment: jest.fn(),
    })),
  };
});

// Issue #80: mock only pool.query (as src/__tests__/auditLog.test.ts
// already does) — NOT logKeypairIssuance itself, unlike auth.test.ts and
// wallet.feeBump.test.ts. Those two suites mock logKeypairIssuance
// wholesale, so neither can ever assert on the arguments the route
// actually passes across that boundary. This test drives a real request
// through the real router/middleware stack so the seam between "what the
// route passes" and "what actually reaches Postgres" is exercised at
// least once.
jest.mock("../../src/db", () => ({
  pool: { query: jest.fn().mockResolvedValue(undefined) },
}));

import { createHash } from "crypto";
import request from "supertest";
import { createApp } from "../../src/app";
import { pool } from "../../src/db";

const app = createApp();

describe("POST /api/v1/wallet/keypair -> keypair_audit_log (issue #80)", () => {
  beforeEach(() => {
    (pool.query as jest.Mock).mockClear();
  });

  it("drives a real Bearer-only request through the router and asserts what pool.query actually receives", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .set("x-api-key", "test-api-key");
    const { accessToken } = login.body;

    // Realistic, currently-passing call shape: /wallet/keypair sits behind
    // jwtAuth, which only ever looks at `Authorization: Bearer ...` — no
    // x-api-key is sent here, deliberately, matching how a real client
    // calls this route once it holds a JWT (see auth.test.ts's "accepts
    // authenticated request with valid Bearer token" case, which this
    // mirrors but extends with assertions on the audit-log call itself).
    const res = await request(app)
      .post("/api/v1/wallet/keypair")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
    expect(sql).toContain("INSERT INTO keypair_audit_log");
    expect(params).toHaveLength(2);
    expect(params[1]).toBe(res.body.publicKey);

    // The seam this issue exists to cover, made explicit: the route reads
    // `req.header("x-api-key")` (src/routes/wallet.ts) even though this
    // route is authenticated via Bearer JWT, not x-api-key — so with no
    // x-api-key header sent, `logKeypairIssuance` is currently invoked
    // with an empty string and ends up hashing "" instead of anything
    // tied to the real caller identity (bug filed separately as #88).
    //
    // This assertion intentionally FAILS against current main, per the
    // project's red -> green testing convention (CONTRIBUTING.md): it
    // pins down exactly the wrong value logged today, and will start
    // passing once #88's fix stops hashing an empty string here. Leaving
    // it red is the point — it's what makes this test capable of catching
    // the bug, rather than silently agreeing with it.
    const hashOfEmptyString = createHash("sha256").update("").digest("hex");
    expect(params[0]).not.toBe(hashOfEmptyString);
  });
});
