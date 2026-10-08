import request from "supertest";
import { createApp } from "../../src/app";

// Issue #91: /auth/login previously relied solely on the generous global
// limiter in app.ts (100 requests / 15 min, shared across every route
// including /health). This asserts the route-specific limiter added on
// /auth/login kicks in at its own, tighter threshold — pinning the exact
// count at which 429 starts appearing, not just that 429 shows up
// eventually, so an accidental future loosening of the limit is caught.
const LOGIN_RATE_LIMIT_MAX = 10;

describe("POST /api/v1/auth/login rate limiting (issue #91)", () => {
  it("allows exactly LOGIN_RATE_LIMIT_MAX attempts, then returns 429", async () => {
    const app = createApp();
    const ip = "198.51.100.42"; // isolate this test's bucket from other tests

    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX; i++) {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("x-api-key", `wrong-guess-${i}`)
        .set("X-Forwarded-For", ip);
      expect(res.status).toBe(401);
    }

    const blocked = await request(app)
      .post("/api/v1/auth/login")
      .set("x-api-key", "wrong-guess-final")
      .set("X-Forwarded-For", ip);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("LOGIN_RATE_LIMITED");
  });

  it("also rate-limits a caller guessing the correct key eventually, once over budget", async () => {
    const app = createApp();
    const ip = "198.51.100.43";

    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX; i++) {
      await request(app)
        .post("/api/v1/auth/login")
        .set("x-api-key", `wrong-guess-${i}`)
        .set("X-Forwarded-For", ip);
    }

    // Even the *correct* key is blocked once the per-route budget for this
    // caller is exhausted — the limiter runs ahead of apiKeyAuth.
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("x-api-key", "test-api-key")
      .set("X-Forwarded-For", ip);
    expect(res.status).toBe(429);
  });

  it("does not rate-limit a different caller sharing the same process", async () => {
    const app = createApp();
    const attackerIp = "198.51.100.99";

    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX; i++) {
      await request(app)
        .post("/api/v1/auth/login")
        .set("x-api-key", `wrong-guess-${i}`)
        .set("X-Forwarded-For", attackerIp);
    }

    const legitimateCaller = await request(app)
      .post("/api/v1/auth/login")
      .set("x-api-key", "test-api-key")
      .set("X-Forwarded-For", "198.51.100.100");

    expect(legitimateCaller.status).toBe(200);
  });
});
