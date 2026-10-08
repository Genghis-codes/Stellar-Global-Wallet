import { NextFunction, Request, Response } from "express";
import { AppError, InternalServerError, isAppError } from "../errors/appError";
import { SorobanTransactionError } from "../services/sorobanErrors";

function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new InternalServerError(error.message);
  }

  return new InternalServerError();
}

function toErrorBody(error: AppError) {
  const body: Record<string, unknown> = {
    code: error.code,
    error: error.message,
  };

  if (error.details !== undefined) {
    body.details = error.details;
  }

  if (error.retryable !== undefined) {
    body.retryable = error.retryable;
  }

  if (error instanceof SorobanTransactionError) {
    body.hash = error.hash;
  }

  return body;
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error(err);
  const error = toAppError(err);
  res.status(error.status).json(toErrorBody(error));
}
