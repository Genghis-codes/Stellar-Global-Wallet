import request from "supertest";
import { createApp } from "../src/app";
import { StellarService } from "../src/services/stellar";
import { SorobanService } from "../src/services/soroban";
import { GlobeWalletContract } from "../src/services/contracts/globeWallet";
import { config } from "../src/config";

// createApp accepts injected services; these tests only exercise the proxy /
// rate-limit middleware, so the real services are constructed but never
// reached (no route under test hits Horizon or Soroban).
function buildTestApp() {
  const stellar = new StellarService();
  const globeWallet = new GlobeWalletContract(new SorobanService());
  return createApp(stellar, globeWallet);
}

// The global limiter in app.ts allows 100 requests per window.
const RATE_LIMIT_MAX = 100;

describe("trust proxy configuration (issue #90)", () => {
  it("applies the configured hop count to Express's trust proxy setting", () => {
    const app = buildTestApp();

    // Before the fix this returned Express's default (false), which is what
    // made express-rate-limit key every proxied client on the load
    // balancer's own address. Asserting the wired value — rather than just
    // that requests succeed — is what makes this test fail on main.
    expect(app.get("trust proxy")).toBe(config.TRUST_PROXY_HOPS);
    expect(app.get("trust proxy")).not.toBe(false);
  });

  it("gives two distinct forwarded IPs independent rate-limit buckets", async () => {
    const app = buildTestApp();

    // Spend part of IP A's allowance.
    const usedByA = 5;
    for (let i = 0; i < usedByA; i++) {
      await request(app).get("/health").set("X-Forwarded-For", "203.0.113.1");
    }

    // A different forwarded IP must start from a full, untouched bucket.
    const res = await request(app)
      .get("/health")
      .set("X-Forwarded-For", "203.0.113.2");

    expect(res.status).toBe(200);
    // This is the real regression the issue describes. With trust proxy set,
    // IP B is keyed on its own address and has spent only this one request
    // (99 left). Without it, both IPs collapse onto the proxy's address and
    // this reads 94 — so the exact number, not just its presence, is what
    // distinguishes fixed from broken.
    expect(res.headers["ratelimit-remaining"]).toBe(String(RATE_LIMIT_MAX - 1));
  });

  it("keeps counting repeated requests from the same forwarded IP in one bucket", async () => {
    const app = buildTestApp();

    const first = await request(app)
      .get("/health")
      .set("X-Forwarded-For", "203.0.113.3");
    const second = await request(app)
      .get("/health")
      .set("X-Forwarded-For", "203.0.113.3");

    // Per-IP limiting still has to accumulate for a single client — a fix
    // that gave every request its own bucket would defeat rate limiting
    // entirely while still passing the test above.
    expect(first.headers["ratelimit-remaining"]).toBe(String(RATE_LIMIT_MAX - 1));
    expect(second.headers["ratelimit-remaining"]).toBe(String(RATE_LIMIT_MAX - 2));
  });

  it("still rate-limits normally with no proxy headers present (regression check)", async () => {
    const app = buildTestApp();

    const first = await request(app).get("/health");
    const second = await request(app).get("/health");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // The direct-connection case (local dev, or TRUST_PROXY_HOPS=0) must
    // keep working exactly as before — "No regressions in adjacent
    // behavior" from CONTRIBUTING.md. This one passes both before and
    // after the fix by design; that is the point of a regression check.
    expect(first.headers["ratelimit-remaining"]).toBe(String(RATE_LIMIT_MAX - 1));
    expect(second.headers["ratelimit-remaining"]).toBe(String(RATE_LIMIT_MAX - 2));
  });
});

// Scope note, stated rather than hidden: supertest connects directly, with no
// real proxy in front, so this suite verifies that Express applies the
// configured hop count and that the limiter keys per forwarded IP. It cannot
// verify that the deployed topology's real hop count matches
// TRUST_PROXY_HOPS, nor that spoofing is impossible for hop counts > 1 —
// those are deployment-layer facts, covered by the manual verification in
// the PR description.
