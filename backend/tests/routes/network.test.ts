import express from "express";
import request from "supertest";
import { createNetworkRouter, FALLBACK_FEES } from "../../src/routes/network";

function appWith(fetcher: () => Promise<any>) {
  const app = express();
  app.use("/api/v1/network", createNetworkRouter(fetcher));
  return app;
}

const stats = {
  last_ledger_base_fee: "100",
  ledger_capacity_usage: "0.42",
  fee_charged: { p10: "100", p50: "200", p90: "1500" },
};

describe("GET /api/v1/network/fees", () => {
  it("maps p10/p50/p90 to low/normal/high", async () => {
    const res = await request(appWith(async () => stats)).get("/api/v1/network/fees");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      low: { stroops: "100", xlm: "0.0000100" },
      normal: { stroops: "200", xlm: "0.0000200" },
      high: { stroops: "1500", xlm: "0.0001500" },
      ledgerCapacityUsage: "0.42",
      source: "horizon",
    });
  });

  it("never reports less than the base fee", async () => {
    const low = { ...stats, fee_charged: { p10: "0", p50: "50", p90: "100" } };
    const res = await request(appWith(async () => low)).get("/api/v1/network/fees");
    expect(res.body.low.stroops).toBe("100");
    expect(res.body.normal.stroops).toBe("100");
  });

  it("caches Horizon responses", async () => {
    const fetcher = jest.fn(async () => stats);
    const app = appWith(fetcher);
    await request(app).get("/api/v1/network/fees");
    await request(app).get("/api/v1/network/fees");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("falls back to the base fee when Horizon is down", async () => {
    const res = await request(
      appWith(async () => {
        throw new Error("ECONNREFUSED");
      })
    ).get("/api/v1/network/fees");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(FALLBACK_FEES);
  });
});
