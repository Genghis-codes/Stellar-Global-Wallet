/**
 * Email notification routes (#90, #93).
 *
 * POST /api/v1/me/email         — submit/re-submit email for verification
 * POST /api/v1/me/email/verify  — confirm a verification token from the link
 * GET  /api/v1/me/email         — get current verified email status
 *
 * Locale-aware: uses req.locale (set by localeMiddleware) so error messages
 * and email content respect the caller's Accept-Language header (#93).
 */

import { Router } from "express";
import { body } from "express-validator";
import { withAccountContext } from "../db";
import { jwtAuth } from "../middleware/jwtAuth";
import { assertValidRequest } from "../middleware/requestValidation";
import {
  sendVerificationEmail,
  verifyToken,
  getVerifiedEmail,
} from "../services/emailVerification";

export const emailRouter = Router();

emailRouter.use(jwtAuth);

/** POST /api/v1/me/email — register or re-register an email for verification. */
emailRouter.post(
  "/",
  body("email").isEmail().normalizeEmail().withMessage("email must be a valid email address"),
  async (req, res, next) => {
    try {
      assertValidRequest(req);
      const { email } = req.body as { email: string };
      const account = req.user!.sub;
      const locale = req.locale ?? "en";

      await withAccountContext(account, (tx) =>
        sendVerificationEmail(account, email, locale, tx)
      );
      res.status(202).json({
        message: "Verification email sent. Please check your inbox.",
      });
    } catch (err) {
      next(err);
    }
  }
);

/** POST /api/v1/me/email/verify — confirm the token from the link. */
emailRouter.post(
  "/verify",
  body("token").isString().notEmpty().withMessage("token is required"),
  async (req, res, next) => {
    try {
      assertValidRequest(req);
      const { token } = req.body as { token: string };
      const account = req.user!.sub;
      const { email } = await withAccountContext(account, (tx) => verifyToken(token, tx));
      res.json({ message: "Email verified successfully.", email });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/v1/me/email — return the verified email or null. */
emailRouter.get("/", async (req, res, next) => {
  try {
    const account = req.user!.sub;
    const email = await withAccountContext(account, (tx) => getVerifiedEmail(account, tx));
    res.json({ email, verified: email !== null });
  } catch (err) {
    next(err);
  }
});
