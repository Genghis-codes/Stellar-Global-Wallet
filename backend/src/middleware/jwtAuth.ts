import { Request, Response, NextFunction } from "express";
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
  } catch {
    next(new UnauthorizedError("Invalid or expired token", "AUTH_TOKEN_INVALID"));
  }
}
