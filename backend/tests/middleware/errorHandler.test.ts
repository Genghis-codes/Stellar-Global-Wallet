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
      error: "sequence changed, safe to retry",
      code: "SEQUENCE_CONFLICT",
      retryable: true,
    });
  });

  it("maps LockAcquisitionError to 503 with code + retryable", () => {
    const res = mockRes();
    const err = new LockAcquisitionError("timed out waiting for lock");

    errorHandler(err, {} as never, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: "timed out waiting for lock",
      code: "LOCK_TIMEOUT",
      retryable: true,
    });
  });

  it("maps MemoRequiredError to 400 with code + retryable", () => {
    const res = mockRes();
    const err = new MemoRequiredError("destination requires a memo");

    errorHandler(err, {} as never, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "destination requires a memo",
      code: "MEMO_REQUIRED",
      retryable: false,
    });
  });

  it("maps SorobanNotConfiguredError to 503 with code + retryable", () => {
    const res = mockRes();
    const err = new SorobanNotConfiguredError();

    errorHandler(err, {} as never, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: "Soroban contract integration is not configured (missing contract ID)",
      code: "SOROBAN_NOT_CONFIGURED",
      retryable: false,
    });
  });

  it("maps SorobanSimulationError to 422 with code + retryable", () => {
    const res = mockRes();
    const err = new SorobanSimulationError("simulation failed: host invocation error");

    errorHandler(err, {} as never, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      error: "simulation failed: host invocation error",
      code: "SOROBAN_SIMULATION_FAILED",
      retryable: false,
    });
  });

  it("maps SorobanSimulationError's optional raw diagnostic into details", () => {
    const res = mockRes();
    const err = new SorobanSimulationError("simulation failed", "raw diagnostic event dump");

    errorHandler(err, {} as never, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      error: "simulation failed",
      code: "SOROBAN_SIMULATION_FAILED",
      retryable: false,
      details: { raw: "raw diagnostic event dump" },
    });
  });

  it("maps SorobanTransactionError to 502 with code, retryable, and hash", () => {
    const res = mockRes();
    const err = new SorobanTransactionError("transaction failed on-chain", "soroban-tx-hash-123");

    errorHandler(err, {} as never, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      error: "transaction failed on-chain",
      code: "SOROBAN_TX_FAILED",
      retryable: false,
      details: { hash: "soroban-tx-hash-123" },
      hash: "soroban-tx-hash-123",
    });
  });

  it("falls back to 500 for a generic error", () => {
    const res = mockRes();
    errorHandler(new Error("something else broke"), {} as never, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "something else broke",
      code: "INTERNAL_ERROR",
    });
  });

  it("does not infer 404 from a generic error message", () => {
    const res = mockRes();
    errorHandler(new Error("Not Found"), {} as never, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Not Found",
      code: "INTERNAL_ERROR",
    });
  });
});
