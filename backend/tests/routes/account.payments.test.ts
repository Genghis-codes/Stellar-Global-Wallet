const getPaymentHistoryMock = jest.fn().mockResolvedValue({
  payments: [
    {
      id: "1",
      type: "payment",
      transactionHash: "abc",
      createdAt: "2024-01-01T00:00:00Z",
      from: "GFROM",
      to: "GTO",
      amount: "0.0000001",
      assetType: "native",
      assetCode: undefined,
      assetIssuer: undefined,
      memo: "claim your prize at https://evil.example",
      flags: ["dust", "memo_url"],
    },
  ],
  next: undefined,
  hasMore: false,
});

jest.mock("../../src/services/stellar", () => {
  return {
    StellarService: jest.fn().mockImplementation(() => ({
      getPaymentHistory: getPaymentHistoryMock,
    })),
  };
});

import request from "supertest";
import { createApp } from "../../src/app";

const app = createApp();

describe("GET /api/v1/account/:publicKey/payments", () => {
  const G_ADDRESS = "GBZH7QMRVYFLVYQRY6O5SOM3G7MSQF7MMUEM3WUOGRV26W3R3K5M7G8A";

  it("returns the flagged payment history", async () => {
    const res = await request(app)
      .get(`/api/v1/account/${G_ADDRESS}/payments`)
      .expect(200);

    expect(res.body).toHaveProperty("payments");
    expect(res.body.payments).toHaveLength(1);
    expect(res.body.payments[0].flags).toEqual(["dust", "memo_url"]);
  });

  it("passes limit and cursor through to the service", async () => {
    await request(app)
      .get(`/api/v1/account/${G_ADDRESS}/payments?limit=10&cursor=abc123`)
      .expect(200);

    expect(getPaymentHistoryMock).toHaveBeenCalledWith(G_ADDRESS, {
      limit: 10,
      cursor: "abc123",
    });
  });

  it("rejects an invalid limit with 400", async () => {
    const res = await request(app)
      .get(`/api/v1/account/${G_ADDRESS}/payments?limit=0`)
      .expect(400);

    expect(res.body.error.details).toBeDefined();
  });

  it("rejects an invalid public key with 400", async () => {
    await request(app).get("/api/v1/account/not-a-key/payments").expect(400);
  });
});
