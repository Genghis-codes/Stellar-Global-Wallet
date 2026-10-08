import request from "supertest";
import express, { Express } from "express";
import morgan from "morgan";
import { body } from "express-validator";
import { assertValidRequest } from "../../src/middleware/requestValidation";

describe("Morgan middleware body logging security", () => {
  let app: Express;
  let logOutput: string[] = [];

  beforeEach(() => {
    logOutput = [];
    app = express();

    // Set up morgan to capture output instead of writing to stdout
    app.use(
      morgan((tokens, req, res) => {
        const log = morgan.combined(tokens, req, res);
        if (log) {
          logOutput.push(log);
        }
        return log;
      })
    );

    app.use(express.json());

    // Simple test endpoint that accepts a secret
    app.post(
      "/test-secret",
      body("secretKey").isLength({ min: 10 }),
      (req, res, next) => {
        try {
          assertValidRequest(req);
          res.json({ success: true });
        } catch (err) {
          next(err);
        }
      }
    );
  });

  it("should not log request body containing a secret key", async () => {
    const secretKey = "S" + "X".repeat(55); // Simulate a Stellar secret key
    const payload = {
      secretKey,
      destinationPublicKey: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      amount: "100",
    };

    await request(app)
      .post("/test-secret")
      .set("Content-Type", "application/json")
      .send(payload);

    // Verify that the secret key does NOT appear in any log line
    logOutput.forEach((log) => {
      expect(log).not.toContain(secretKey);
      expect(log).not.toContain(JSON.stringify(payload));
    });
  });

  it("should not log request body containing sourceSecretKey", async () => {
    const sourceSecretKey = "S" + "Y".repeat(55);
    const payload = {
      sourceSecretKey,
      destinationPublicKey: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      amount: "100",
    };

    await request(app)
      .post("/test-secret")
      .set("Content-Type", "application/json")
      .send({ secretKey: sourceSecretKey }); // wrapped as secretKey for validation

    logOutput.forEach((log) => {
      expect(log).not.toContain(sourceSecretKey);
      expect(log).not.toContain(JSON.stringify(payload));
    });
  });

  it("should not log request body containing signerSecretKeys", async () => {
    const signerKey1 = "S" + "A".repeat(55);
    const signerKey2 = "S" + "B".repeat(55);
    const payload = {
      signerSecretKeys: [signerKey1, signerKey2],
    };

    await request(app)
      .post("/test-secret")
      .set("Content-Type", "application/json")
      .send({ secretKey: signerKey1 }); // wrapped as secretKey for validation

    logOutput.forEach((log) => {
      expect(log).not.toContain(signerKey1);
      expect(log).not.toContain(signerKey2);
    });
  });

  it("should log method, URL, and status code (non-sensitive info)", async () => {
    await request(app)
      .post("/test-secret")
      .set("Content-Type", "application/json")
      .send({ secretKey: "S" + "X".repeat(55) });

    const allLogs = logOutput.join("");
    expect(allLogs).toContain("POST");
    expect(allLogs).toContain("/test-secret");
    expect(allLogs).toMatch(/\s200\s/); // status code 200
  });

  it("should not log response body", async () => {
    const secretInResponse = "SECRET_VALUE_IN_RESPONSE";

    app.post("/test-response", (req, res) => {
      res.json({ data: secretInResponse, user: "test" });
    });

    await request(app).post("/test-response");

    logOutput.forEach((log) => {
      expect(log).not.toContain(secretInResponse);
    });
  });
});
