import { Router } from "express";
import { Keypair, StrKey, WebAuth } from "@stellar/stellar-sdk";
import { body, query } from "express-validator";
import { rateLimit } from "express-rate-limit";
import { AppError, UnauthorizedError } from "../errors/appError";
import { apiKeyAuth } from "../middleware/apiKeyAuth";
import { assertValidRequest } from "../middleware/requestValidation";
import {
  generateAccessToken,
  generateRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} from "../utils/jwt";
import { config } from "../config";

export const authRouter = Router();

// Dedicated, tighter rate limit for this route specifically (issue #91).
// /auth/login is the one endpoint that authenticates directly against the
// shared API_KEY secret, so it's the highest-value credential-guessing
// target in the API — the generous global limiter in app.ts (100 req /
// 15 min, shared across every route including /health) is not calibrated
// to that. This budget applies independently, on top of the global one.
//
// The handler routes through errorHandler (issue #22) so the response uses
// the shared error envelope instead of express-rate-limit's default body.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(
      new AppError("Too many login attempts, please try again later", {
        code: "RATE_LIMITED",
        status: 429,
        retryable: true,
      })
    );
  },
});

// SEP-10 challenge lifetime in seconds.
const CHALLENGE_TTL_SECONDS = 300;

// Use the configured passphrase rather than deriving one from
// STELLAR_NETWORK, so challenges always match the network Horizon serves.
const networkPassphrase = config.NETWORK_PASSPHRASE;

function getServerKeypair(): Keypair {
  if (!config.SEP10_SIGNING_SECRET) {
    throw new AppError("SEP-10 authentication is not configured on this server", {
      code: "SEP10_NOT_CONFIGURED",
      status: 503,
    });
  }
  return Keypair.fromSecret(config.SEP10_SIGNING_SECRET);
}

authRouter.post(
  "/login",
  loginLimiter,
  apiKeyAuth,
  async (_req, res, next) => {
    try {
      // We currently use a single shared API key model.
      // This fixed 'sub' explicitly documents that all traffic shares
      // a single identity, rather than implying per-caller signal.
      // See #88 and this identity decision for context.
      const sub = "api-key-user";
      const accessToken = generateAccessToken(sub, "api-key");
      const refreshToken = await generateRefreshToken(sub, { authMethod: "api-key" });
      res.json({ accessToken, refreshToken, tokenType: "Bearer" });
    } catch (err) {
      next(err);
    }
  }
);

// SEP-10: build a challenge transaction the wallet must sign.
authRouter.get(
  "/challenge",
  query("account").isString().notEmpty(),
  async (req, res, next) => {
    try {
      assertValidRequest(req);
      const account = String(req.query.account);
      if (!StrKey.isValidEd25519PublicKey(account)) {
        throw new AppError("Invalid Stellar account", { code: "INVALID_ADDRESS", status: 400 });
      }
      const challenge = WebAuth.buildChallengeTx(
        getServerKeypair(),
        account,
        config.HOME_DOMAIN,
        CHALLENGE_TTL_SECONDS,
        networkPassphrase,
        config.WEB_AUTH_DOMAIN
      );
      res.json({ transaction: challenge, networkPassphrase });
    } catch (err) {
      next(err);
    }
  }
);

// SEP-10: verify the signed challenge and issue per-user JWTs.
authRouter.post(
  "/token",
  body("transaction").isString().notEmpty(),
  async (req, res, next) => {
    try {
      assertValidRequest(req);
      const serverKeypair = getServerKeypair();
      const transaction = String(req.body.transaction);
      const { clientAccountID } = WebAuth.readChallengeTx(
        transaction,
        serverKeypair.publicKey(),
        networkPassphrase,
        config.HOME_DOMAIN,
        config.WEB_AUTH_DOMAIN
      );

      // Verify the challenge is signed by the client account. For unfunded
      // accounts the master key is the only signer; funded accounts may be
      // multisig, so we check signers/thresholds against Horizon.
      const signers = await loadAccountSigners(clientAccountID);
      if (signers) {
        WebAuth.verifyChallengeTxThreshold(
          transaction,
          serverKeypair.publicKey(),
          networkPassphrase,
          signers.threshold,
          signers.signers,
          config.HOME_DOMAIN,
          config.WEB_AUTH_DOMAIN
        );
      } else {
        WebAuth.verifyChallengeTxSigners(
          transaction,
          serverKeypair.publicKey(),
          networkPassphrase,
          [clientAccountID],
          config.HOME_DOMAIN,
          config.WEB_AUTH_DOMAIN
        );
      }

      const sub = clientAccountID;
      const accessToken = generateAccessToken(sub, "sep10");
      const refreshToken = await generateRefreshToken(sub, { authMethod: "sep10" });
      res.json({
        accessToken,
        refreshToken,
        tokenType: "Bearer",
        account: sub,
        auth_method: "sep10",
      });
    } catch (err) {
      // A forged, expired, wrong-network or under-signed challenge is the
      // client's problem (401), not a server failure.
      if (err instanceof WebAuth.InvalidChallengeError) {
        next(new UnauthorizedError(err.message, "SEP10_CHALLENGE_INVALID"));
        return;
      }
      next(err);
    }
  }
);

interface AccountSigners {
  threshold: number;
  signers: { key: string; weight: number; type: string }[];
}

// Load signers from Horizon. Returns null for unfunded accounts (404),
// in which case the caller falls back to master-key verification.
async function loadAccountSigners(account: string): Promise<AccountSigners | null> {
  const url = `${config.HORIZON_URL.replace(/\/$/, "")}/accounts/${account}`;
  const response = await fetch(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    // Horizon being unavailable is not the caller's fault: report it as an
    // upstream failure the client may retry, not as a 401.
    throw new AppError("Unable to load account signers", {
      code: "SIGNER_LOOKUP_FAILED",
      status: 502,
      retryable: true,
    });
  }
  const data = (await response.json()) as {
    thresholds?: { med_threshold?: number };
    signers?: { key: string; weight: number; type: string }[];
  };
  return {
    threshold: data.thresholds?.med_threshold ?? 0,
    signers: data.signers ?? [],
  };
}

authRouter.post(
  "/refresh",
  body("refreshToken").isString().notEmpty(),
  async (req, res, next) => {
    try {
      assertValidRequest(req);
      const result = await rotateRefreshToken(req.body.refreshToken);
      if (!result) {
        throw new UnauthorizedError(
          "Invalid, expired, or revoked refresh token",
          "REFRESH_TOKEN_INVALID"
        );
      }
      res.json({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        tokenType: "Bearer",
      });
    } catch (err) {
      next(err);
    }
  }
);

authRouter.post(
  "/logout",
  body("refreshToken").isString().notEmpty(),
  async (req, res, next) => {
    try {
      assertValidRequest(req);
      await revokeRefreshToken(req.body.refreshToken);
      res.json({ message: "Logged out" });
    } catch (err) {
      next(err);
    }
  }
);
