import { NextFunction, Request, Response } from "express";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { AccountMismatchError, UnauthorizedError } from "../errors/appError";

export type TargetAccountResolver = (req: Request) => string | undefined;

/**
 * Body/query fields that name the account a request acts *as*, in priority
 * order. Routes that carry two addresses list the actor first: guardian
 * changes are signed by `admin`, recovery approvals by `guardian`, admin
 * proposals by `currentAdmin`, and admin acceptance by `candidate`.
 */
const ACTOR_FIELDS = [
  "sourcePublicKey",
  "sourceAccount",
  "source",
  "account",
  "innerAccount",
  "user",
  "userPublicKey",
  "admin",
  "currentAdmin",
  "guardian",
  "candidate",
] as const;

export type ActorField = (typeof ACTOR_FIELDS)[number];

/** Legacy custodial fields that carry a raw secret seed instead of a public key. */
const SECRET_ACTOR_FIELDS = [
  "sourceSecretKey",
  "userSecretKey",
  "feeSecretKey",
] as const;

function tryPublicKeyFromSecret(value: unknown): string | undefined {
  if (typeof value !== "string" || !StrKey.isValidEd25519SecretSeed(value)) {
    return undefined;
  }
  try {
    return Keypair.fromSecret(value).publicKey();
  } catch {
    return undefined;
  }
}

/**
 * Collects every actor value present in the request body/query, keyed by
 * field name. Used to detect ambiguous requests that name more than one
 * account (#266).
 */
function collectActorValues(req: Request): Map<string, string> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;
  const found = new Map<string, string>();
  for (const field of ACTOR_FIELDS) {
    for (const value of [body[field], query[field]]) {
      if (typeof value === "string" && value.length > 0) {
        found.set(field, value);
        break;
      }
    }
  }
  for (const field of SECRET_ACTOR_FIELDS) {
    const derived = tryPublicKeyFromSecret(body[field]);
    if (derived) found.set(field, derived);
  }
  if (Array.isArray(body.signerSecretKeys)) {
    const derivedKeys = body.signerSecretKeys
      .map((entry) => tryPublicKeyFromSecret(entry))
      .filter((k): k is string => k !== undefined);
    if (derivedKeys.length > 0) {
      const sub = req.user?.sub;
      const chosen = sub && derivedKeys.includes(sub) ? sub : derivedKeys[0];
      found.set("signerSecretKeys", chosen);
    }
  }
  return found;
}

/**
 * Resolves the acting account from the request. When `actorField` is given,
 * only that field is consulted so authorization is decided on the same field
 * the handler acts on (#266). Without it, the first non-empty field in
 * priority order is returned (legacy behaviour).
 */
export function resolveActingAccount(
  req: Request,
  actorField?: ActorField
): string | undefined {
  if (actorField) {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const query = (req.query ?? {}) as Record<string, unknown>;
    for (const value of [body[actorField], query[actorField]]) {
      if (typeof value === "string" && value.length > 0) return value;
    }
    return undefined;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;
  for (const field of ACTOR_FIELDS) {
    for (const value of [body[field], query[field]]) {
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  for (const field of SECRET_ACTOR_FIELDS) {
    const derived = tryPublicKeyFromSecret(body[field]);
    if (derived) return derived;
  }
  if (Array.isArray(body.signerSecretKeys)) {
    const derivedKeys = body.signerSecretKeys
      .map((entry) => tryPublicKeyFromSecret(entry))
      .filter((k): k is string => k !== undefined);
    if (derivedKeys.length > 0) {
      const sub = req.user?.sub;
      if (sub && derivedKeys.includes(sub)) return sub;
      return derivedKeys[0];
    }
  }
  return undefined;
};

/**
 * Enforces account scoping for signed-XDR submission endpoints where the
 * acting account lives inside the base64 XDR envelope rather than a JSON
 * field (#233). For fee-bump envelopes, either the inner source or the fee
 * source may match the authenticated subject.
 */
export function assertSignedXdrAccountMatch(
  sub: string | undefined,
  sourcePublicKey: string,
  feeSourcePublicKey?: string
): void {
  if (!sub) {
    throw new UnauthorizedError("Authentication required", "AUTH_HEADER_INVALID");
  }
  if (!StrKey.isValidEd25519PublicKey(sub)) {
    return;
  }
  if (sourcePublicKey === sub || (feeSourcePublicKey !== undefined && feeSourcePublicKey === sub)) {
    return;
  }
  throw new AccountMismatchError(undefined, { authenticated: sub, requested: sourcePublicKey });
}

/**
 * #33 — deny-by-default account scoping: a JWT issued to account A must
 * not be usable to build or submit transactions for account B. Mount after
 * jwtAuth.
 *
 * #266 — each route declares the single actor field it acts on via
 * `actorField`; only that field is validated. Requests that name multiple
 * actor fields with different values are rejected as ambiguous, and
 * protected routes that name no actor are denied by default.
 *
 * Tokens from the legacy shared API key carry a non-account subject
 * ("api-key-user") and are not scoped, matching #88's single-identity model.
 */
export function requireAccountMatch(
  actorField?: ActorField,
  resolve: TargetAccountResolver = (req) => resolveActingAccount(req, actorField)
) {
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

    // Reject ambiguous requests that name multiple actor fields with
    // different values (#266).
    const actors = collectActorValues(req);
    const distinct = new Set(actors.values());
    if (distinct.size > 1) {
      next(
        new AccountMismatchError(undefined, {
          authenticated: sub,
          requested: Array.from(distinct).join(","),
        })
      );
      return;
    }

    const target = resolve(req);
    if (target === undefined) {
      // Deny by default: a protected route must name the actor it acts on.
      next(new UnauthorizedError("Actor account required", "AUTH_HEADER_INVALID"));
      return;
    }
    if (target !== sub) {
      next(new AccountMismatchError(undefined, { authenticated: sub, requested: target }));
      return;
    }
    next();
  };
}
