import { Request } from "express";
import { validationResult } from "express-validator";
import { ValidationError, ValidationIssue } from "../errors/appError";

type ValidationResultIssue = {
  location?: string;
  msg: unknown;
  path?: string;
  type?: string;
  value?: unknown;
};

export function assertValidRequest(req: Request) {
  const result = validationResult(req);
  if (result.isEmpty()) {
    return;
  }

  const issues: ValidationIssue[] = (result.array() as ValidationResultIssue[]).map((issue) => ({
    location: issue.location,
    message: String(issue.msg),
    path: issue.path,
    type: issue.type,
    value: issue.value,
  }));

  throw new ValidationError(issues);
}
