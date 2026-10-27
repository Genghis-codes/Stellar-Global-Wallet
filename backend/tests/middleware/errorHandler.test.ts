import { Response } from "express";
import { errorHandler } from "../../src/middleware/errorHandler";
import { LockAcquisitionError, SequenceConflictError, MemoRequiredError } from "../../src/services/stellarErrors";
import {
  SorobanNotConfiguredError,
  SorobanSimulationError,
  SorobanTransactionError,
} from "../../src/services/sorobanErrors";

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe("errorHandler", () => {
  it("maps SequenceConflictError to 409 with code + retryable", () => {
    const res = mockRes();
    const err = new SequenceConflictError("sequence changed, safe to retry");

    errorHandler(err, {} as never, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: "sequence changed, safe to retry",
        code: "SEQUENCE_CONFLICT",
        retryable: true,
      },
    });
  });

  it("maps LockAcquisitionError to 503 with code + retryable", () => {
    const res = mockRes();
    const err = new LockAcquisitionError("timed out waiting for lock");

    errorHandler(err, {} as never, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: "timed out waiting for lock",
        code: "LOCK_TIMEOUT",
        retryable: true,
      },
    });
  });

  it("maps MemoRequiredError to 400 with code + retryable", () => {
    const res = mockRes();
    const err = new MemoRequiredError("destination requires a memo");

    errorHandler(err, {} as never, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: "destination requires a memo",
        code: "MEMO_REQUIRED",
        retryable: false,
      },
    });
  });

  it("maps SorobanNotConfiguredError to 503 with code + retryable", () => {
    const res = mockRes();
    const err = new SorobanNotConfiguredError();

    errorHandler(err, {} as never, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: "Soroban contract integration is not configured (missing contract ID)",
        code: "SOROBAN_NOT_CONFIGURED",
        retryable: false,
      },
    });
  });

  it("maps SorobanSimulationError to 422 with code + retryable", () => {
    const res = mockRes();
    const err = new SorobanSimulationError("simulation failed: host invocation error");

    errorHandler(err, {} as never, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: "simulation failed: host invocation error",
        code: "SOROBAN_SIMULATION_FAILED",
        retryable: false,
      },
    });
  });

  it("maps SorobanSimulationError's optional raw diagnostic into details", () => {
    const res = mockRes();
    const err = new SorobanSimulationError("simulation failed", "raw diagnostic event dump");

    errorHandler(err, {} as never, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: "simulation failed",
        code: "SOROBAN_SIMULATION_FAILED",
        retryable: false,
        details: { raw: "raw diagnostic event dump" },
      },
    });
  });

  it("maps SorobanTransactionError to 502 with code, retryable, and hash", () => {
    const res = mockRes();
    const err = new SorobanTransactionError("transaction failed on-chain", "soroban-tx-hash-123");

    errorHandler(err, {} as never, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: "transaction failed on-chain",
        code: "SOROBAN_TX_FAILED",
        retryable: false,
        details: { hash: "soroban-tx-hash-123" },
        hash: "soroban-tx-hash-123",
      },
    });
  });

  it("maps body-parser's entity.too.large error to 413 PAYLOAD_TOO_LARGE instead of 500 (issue #124)", () => {
    const res = mockRes();
    // Shape body-parser actually throws for express.json({ limit }) — a
    // plain Error, not one of our AppError subclasses, with `type` and
    // `status` set. Before this fix it fell through to the generic
    // `error instanceof Error` branch and was reported as a 500
    // INTERNAL_ERROR, hiding a client-side mistake behind a server-failure
    // code and making it impossible to document a real 413 example.
    const err = Object.assign(new Error("request entity too large"), {
      type: "entity.too.large",
      status: 413,
    });

    errorHandler(err, {} as never, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: "Request body exceeds the configured size limit",
        code: "PAYLOAD_TOO_LARGE",
      },
    });
  });

  it("falls back to 500 for a generic error", () => {
    const res = mockRes();
    errorHandler(new Error("something else broke"), {} as never, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: "something else broke",
        code: "INTERNAL_ERROR",
      },
    });
  });

  it("does not infer 404 from a generic error message", () => {
    const res = mockRes();
    errorHandler(new Error("Not Found"), {} as never, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        message: "Not Found",
        code: "INTERNAL_ERROR",
      },
    });
  });
});
