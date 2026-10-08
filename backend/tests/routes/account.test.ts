jest.mock("../../src/services/stellar", () => {
  return {
    StellarService: jest.fn().mockImplementation(() => ({
      getTransactions: jest.fn().mockResolvedValue({
        transactions: [],
        next: undefined,
        hasMore: false,
      }),
    })),
  };
});

import request from "supertest";
import { createApp } from "../../src/app";

const app = createApp();

describe("Account routes limit validation", () => {
  const G_ADDRESS = "GBZH7QMRVYFLVYQRY6O5SOM3G7MSQF7MMUEM3WUOGRV26W3R3K5M7G8A";

  it("accepts a valid limit", async () => {
    const res = await request(app)
      .get(`/api/v1/account/${G_ADDRESS}/transactions?limit=50`)
      .expect(200);

    expect(res.body).toHaveProperty("transactions");
  });

  it("rejects a negative limit with 400", async () => {
    const res = await request(app)
      .get(`/api/v1/account/${G_ADDRESS}/transactions?limit=-5`)
      .expect(400);

    expect(res.body.details).toBeDefined();
    expect(res.body.details[0].message).toMatch(/limit must be an integer between 1 and 100/);
  });

  it("rejects a limit of 0 with 400", async () => {
    const res = await request(app)
      .get(`/api/v1/account/${G_ADDRESS}/transactions?limit=0`)
      .expect(400);

    expect(res.body.details).toBeDefined();
    expect(res.body.details[0].message).toMatch(/limit must be an integer between 1 and 100/);
  });

  it("rejects a non-numeric limit with 400", async () => {
    const res = await request(app)
      .get(`/api/v1/account/${G_ADDRESS}/transactions?limit=abc`)
      .expect(400);

    expect(res.body.details).toBeDefined();
    expect(res.body.details[0].message).toMatch(/limit must be an integer between 1 and 100/);
  });

  it("rejects a limit greater than 100 with 400", async () => {
    const res = await request(app)
      .get(`/api/v1/account/${G_ADDRESS}/transactions?limit=105`)
      .expect(400);

    expect(res.body.details).toBeDefined();
    expect(res.body.details[0].message).toMatch(/limit must be an integer between 1 and 100/);
  });
});
