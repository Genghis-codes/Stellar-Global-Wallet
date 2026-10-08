import { logKeypairIssuance } from "../services/auditLog";
import { pool } from "../db";

jest.mock("../db", () => ({
  pool: { query: jest.fn() },
}));

describe("logKeypairIssuance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("logs the public key and a hash of the API key, never the secret", async () => {
    const apiKey = "test-api-key-123";
    const publicKey = "GBMOGKIKG5YSAV65K3X3X3X3X3X3X3X3X3X3X3X3X3X3X3X3X3X3X3X3";

    await logKeypairIssuance(apiKey, publicKey);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = (pool.query as jest.Mock).mock.calls[0];
    expect(sql).toContain("INSERT INTO keypair_audit_log");
    expect(params).toHaveLength(2);
    expect(params[0]).not.toBe(apiKey);
    expect(params[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(params[1]).toBe(publicKey);
  });
});
