import { AppError } from "../errors/appError";

export class SorobanNotConfiguredError extends AppError {
  constructor(message = "Soroban contract integration is not configured (missing contract ID)") {
    super(message, {
      code: "SOROBAN_NOT_CONFIGURED",
      retryable: false,
      status: 503,
    });
  }
}

export class SorobanSimulationError extends AppError {
  constructor(message: string, readonly raw?: string) {
    super(message, {
      code: "SOROBAN_SIMULATION_FAILED",
      details: raw ? { raw } : undefined,
      retryable: false,
      status: 422,
    });
  }
}

export class SorobanTransactionError extends AppError {
  constructor(message: string, readonly hash: string) {
    super(message, {
      code: "SOROBAN_TX_FAILED",
      details: { hash },
      retryable: false,
      status: 502,
    });
  }
}
