import { NextFunction, Request, Response } from "express";
import { StrKey } from "@stellar/stellar-sdk";
import { AccountMismatchError, UnauthorizedError } from "../errors/appError";

export type TargetAccountResolver = (req: Request) => string | undefined;

/**
 * Body/query fields that name the account a request acts *as*, in priority
 * order. Routes that carry two addresses list the actor first: guardian
 * changes are signed by `admin`, recovery approvals by `guardian`.
 */
const ACTOR_FIELDS = [
  "sourcePublicKey",
  "sourceAccount",
  "source",
  "account",
  "user",
  "userPublicKey",
  "admin",
  "currentAdmin",
  "guardian",
] as const;

export const resolveActingAccount: TargetAccountResolver = (req) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;
  for (const field of ACTOR_FIELDS) {
    for (const value of [body[field], query[field]]) {
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return undefined;
};

/**
 * #33 — deny-by-default account scoping: a JWT issued to account A must
 * not be usable to build or submit transactions for account B. Mount after
 * jwtAuth. Requests that do not name an account pass through.
 *
 * Tokens from the legacy shared API key carry a non-account subject
 * ("api-key-user") and are not scoped, matching #88's single-identity model.
 */
export function requireAccountMatch(resolve: TargetAccountResolver = resolveActingAccount) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const sub = req.user?.sub;
    if (!sub) {
      next(new UnauthorizedError("Authentication required", "AUTH_HEADER_INVALID"));
      return;
    }
    if (!StrKey.isValidEd25519PublicKey(sub)) {
      next();
      return;
    }
    const target = resolve(req);
    if (target !== undefined && target !== sub) {
      next(new AccountMismatchError(undefined, { authenticated: sub, requested: target }));
      return;
    }
    next();
  };
}
