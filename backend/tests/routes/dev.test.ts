import express from "express";
import request from "supertest";
import { createDevRouter } from "../../src/routes/dev";
import { errorHandler } from "../../src/middleware/errorHandler";

const ACCOUNT = "GBLIQBXTAF3O3YINCRDR5O7H47QHHW5GFOYN4HAD6IKOSWD4LWKWWPHP";

function appWith(fetchFn: (url: string) => Promise<Response>) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/dev", createDevRouter(fetchFn));
  app.use(errorHandler);
  return app;
}

describe("POST /api/v1/dev/fund", () => {
  it("rejects an invalid account with 400", async () => {
    const fetchFn = jest.fn();
    const res = await request(appWith(fetchFn)).post("/api/v1/dev/fund").send({ account: "nope" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("funds a new account", async () => {
    const fetchFn = jest.fn(async () => new Response("{}", { status: 200 }));
    const res = await request(appWith(fetchFn)).post("/api/v1/dev/fund").send({ account: ACCOUNT });
    expect(res.body).toEqual({ account: ACCOUNT, funded: true, alreadyFunded: false });
    expect(fetchFn.mock.calls[0][0]).toContain(`addr=${ACCOUNT}`);
  });

  it("treats an already-funded account as success", async () => {
    const fetchFn = async () => new Response("op_already_exists", { status: 400 });
    const res = await request(appWith(fetchFn)).post("/api/v1/dev/fund").send({ account: ACCOUNT });
    expect(res.status).toBe(200);
    expect(res.body.alreadyFunded).toBe(true);
  });

  it("returns 502 when Friendbot is unreachable", async () => {
    const fetchFn = async () => {
      throw new TypeError("fetch failed");
    };
    const res = await request(appWith(fetchFn)).post("/api/v1/dev/fund").send({ account: ACCOUNT });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("HORIZON_UNAVAILABLE");
  });
});
