import express from "express";
import request from "supertest";
import { requireAccountMatch } from "../../src/middleware/requireAccountMatch";
import { errorHandler } from "../../src/middleware/errorHandler";

const ALICE = "GBLIQBXTAF3O3YINCRDR5O7H47QHHW5GFOYN4HAD6IKOSWD4LWKWWPHP";
const BOB = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function appAs(sub: string | undefined) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (sub) req.user = { sub };
    next();
  });
  app.use(requireAccountMatch());
  app.post("/build", (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe("requireAccountMatch (#33)", () => {
  it("allows a request for the authenticated account", async () => {
    const res = await request(appAs(ALICE)).post("/build").send({ sourcePublicKey: ALICE });
    expect(res.status).toBe(200);
  });

  it("rejects a request acting for another account", async () => {
    const res = await request(appAs(ALICE)).post("/build").send({ sourcePublicKey: BOB });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ACCOUNT_MISMATCH");
  });

  it("checks the admin, not the guardian, on guardian changes", async () => {
    const ok = await request(appAs(ALICE)).post("/build").send({ admin: ALICE, guardian: BOB });
    expect(ok.status).toBe(200);
    const denied = await request(appAs(BOB)).post("/build").send({ admin: ALICE, guardian: BOB });
    expect(denied.status).toBe(403);
  });

  it("passes requests that name no account", async () => {
    const res = await request(appAs(ALICE)).post("/build").send({ amount: "1" });
    expect(res.status).toBe(200);
  });

  it("does not scope the legacy shared API-key identity", async () => {
    const res = await request(appAs("api-key-user")).post("/build").send({ sourcePublicKey: BOB });
    expect(res.status).toBe(200);
  });

  it("requires authentication", async () => {
    const res = await request(appAs(undefined)).post("/build").send({});
    expect(res.status).toBe(401);
  });
});
