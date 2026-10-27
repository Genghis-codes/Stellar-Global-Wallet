import { Request, Response, NextFunction } from "express";
import { TokenExpiredError } from "jsonwebtoken";
import { verifyAccessToken } from "../utils/jwt";
import { UnauthorizedError } from "../errors/appError";

export function jwtAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("Authorization");
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
    req.user = { sub: payload.sub };
    next();
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
