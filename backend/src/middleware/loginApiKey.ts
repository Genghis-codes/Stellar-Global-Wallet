import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { config } from "../config";
import { UnauthorizedError } from "../errors/appError";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Checks the shared API key on POST /auth/login only — the one place it is
 * exchanged for a JWT pair. Protected routes never accept `x-api-key` (#40).
 */
export function requireLoginApiKey(req: Request, _res: Response, next: NextFunction) {
  const provided = req.header("x-api-key");
  if (!provided || !safeEqual(provided, config.API_KEY)) {
    next(new UnauthorizedError("Unauthorized", "API_KEY_UNAUTHORIZED"));
    return;
  }
  next();
}
