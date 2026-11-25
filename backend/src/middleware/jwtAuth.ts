import { Request, Response, NextFunction } from "express";
import { TokenExpiredError } from "jsonwebtoken";
import { runWithRequestAccount } from "../rlsContext";
import { isSessionActive, verifyAccessToken } from "../utils/jwt";
import { AppError, UnauthorizedError } from "../errors/appError";

export async function jwtAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("Authorization");
  // No credential at all: tell the client to sign in. A legacy x-api-key
  // (#40) or a non-Bearer header is a malformed credential instead.
  if (!header && !req.header("x-api-key")) {
    next(new UnauthorizedError("Authentication required", "TOKEN_MISSING"));
    return;
  }
  if (!header?.startsWith("Bearer ")) {
    next(
      new UnauthorizedError(
        "Missing or malformed Authorization header",
        "AUTH_HEADER_INVALID"
      )
    );
    return;
  }

  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    if (payload.type !== "access") {
      next(new UnauthorizedError("Invalid token type", "AUTH_TOKEN_TYPE_INVALID"));
      return;
    }

    // #200 — check revocation on every request against the store that
    // issued the session (utils/jwt's refresh-token store). The separate
    // services/sessionStore never sees these sessions, so asking it marked
    // every session-bound token as revoked.
    const sessionId = payload.session_id;
    if (sessionId) {
      let active: boolean;
      try {
        active = await isSessionActive(payload.sub, sessionId);
      } catch {
        // Session store unreachable: a server-side outage, not a bad token —
        // don't make clients throw their credentials away.
        next(
          new AppError("Session store unavailable", {
            code: "SERVICE_UNAVAILABLE",
            status: 503,
            retryable: true,
          })
        );
        return;
      }
      if (!active) {
        next(new UnauthorizedError("Session has been revoked", "SESSION_REVOKED"));
        return;
      }
    }

    req.user = { sub: payload.sub };
    runWithRequestAccount(payload.sub, () => {
      next();
    });
  } catch (err) {
    // Clients refresh only on TOKEN_EXPIRED; anything else (bad signature,
    // malformed token) means signing in again.
    if (err instanceof TokenExpiredError) {
      next(new UnauthorizedError("Access token expired", "TOKEN_EXPIRED"));
      return;
    }
    next(new UnauthorizedError("Invalid token", "AUTH_TOKEN_INVALID"));
  }
}
