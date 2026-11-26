/**
 * Client-side mirror of the backend error envelope (backend/src/middleware/
 * errorHandler.ts): every non-2xx response is
 * `{ error: { code, message, details?, retryable?, requestId } }`.
 */

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
    retryable?: boolean;
    requestId?: string;
  };
}

/** Codes produced by the client itself, never by the backend. */
export type ClientErrorCode = "NETWORK_ERROR" | "TIMEOUT" | "ABORTED" | "INVALID_RESPONSE" | "SESSION_EXPIRED";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly retryable: boolean;
  readonly requestId?: string;

  constructor(
    message: string,
    init: { status: number; code: string; details?: unknown; retryable?: boolean; requestId?: string },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
    this.retryable = init.retryable ?? (init.status === 429 || init.status >= 500);
  }

  /** True for any 401 from the backend (TOKEN_EXPIRED, SESSION_REVOKED, ...). */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const error = (value as { error?: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

/** Build an ApiError from a failed response body (parsed JSON or raw text). */
export function toApiError(status: number, body: unknown, headerRequestId?: string | null): ApiError {
  if (isErrorEnvelope(body)) {
    const { code, message, details, retryable, requestId } = body.error;
    return new ApiError(message, {
      status,
      code,
      details,
      retryable,
      requestId: requestId ?? headerRequestId ?? undefined,
    });
  }
  return new ApiError(`Request failed with status ${status}`, {
    status,
    code: status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR",
    details: body === undefined || body === "" ? undefined : body,
    requestId: headerRequestId ?? undefined,
  });
}

/** A short, user-facing sentence for an error, for toasts and inline alerts. */
export function describeError(error: unknown): string {
  if (isApiError(error)) {
    switch (error.code) {
      case "NETWORK_ERROR":
        return "Can't reach the GlobeWallet server. Check your connection and try again.";
      case "TIMEOUT":
        return "The server took too long to respond. Please try again.";
      case "SESSION_EXPIRED":
        return "Your session has expired. Please sign in again.";
      case "RATE_LIMITED":
      case "LOGIN_RATE_LIMITED":
        return "Too many requests. Wait a moment and try again.";
      default:
        return error.message;
    }
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
