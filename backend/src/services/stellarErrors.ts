import { AppError, HorizonError } from "../errors/appError";

export class SequenceConflictError extends HorizonError {
  constructor(message: string, readonly horizonResultCodes?: unknown) {
    super(message, {
      code: "SEQUENCE_CONFLICT",
      details: horizonResultCodes ? { horizonResultCodes } : undefined,
      retryable: true,
      status: 409,
    });
  }
}

export class MemoRequiredError extends AppError {
  constructor(message: string) {
    super(message, {
      code: "MEMO_REQUIRED",
      retryable: false,
      status: 400,
    });
  }
}

export class LockAcquisitionError extends AppError {
  constructor(message: string) {
    super(message, {
      code: "LOCK_TIMEOUT",
      retryable: true,
      status: 503,
    });
  }
}

export class NonRetryableHorizonError extends HorizonError {
  constructor(message: string, readonly horizonResultCodes?: unknown) {
    super(message, {
      code: "HORIZON_REJECTED",
      details: horizonResultCodes ? { horizonResultCodes } : undefined,
      retryable: false,
      status: 400,
    });
  }
}
