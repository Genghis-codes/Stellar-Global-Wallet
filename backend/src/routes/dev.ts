import { Router } from "express";
import { StrKey } from "@stellar/stellar-sdk";
import { AppError } from "../errors/appError";

const FRIENDBOT_URL = "https://friendbot.stellar.org";
const FRIENDBOT_TIMEOUT_MS = 15_000;

type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/**
 * Testnet-only developer routes (#69). app.ts mounts this router at
 * /api/v1/dev only when STELLAR_NETWORK=testnet, so on mainnet every path
 * here falls through to the 404 handler.
 *
 * POST /fund { account } funds a new account via Friendbot for one-click
 * onboarding. Funding an account that already exists is reported as
 * success with alreadyFunded: true, so the client can call it blindly.
 */
export function createDevRouter(fetchFn: FetchFn = fetch): Router {
  const router = Router();

  router.post("/fund", async (req, res, next) => {
    try {
      const account = req.body?.account;
      if (typeof account !== "string" || !StrKey.isValidEd25519PublicKey(account)) {
        throw new AppError("A valid Stellar account address is required", {
          code: "VALIDATION_ERROR",
          status: 400,
        });
      }

      let response: Response;
      try {
        response = await fetchFn(`${FRIENDBOT_URL}?addr=${encodeURIComponent(account)}`, {
          signal: AbortSignal.timeout(FRIENDBOT_TIMEOUT_MS),
        });
      } catch {
        throw new AppError("Friendbot is unreachable", {
          code: "HORIZON_UNAVAILABLE",
          status: 502,
          retryable: true,
        });
      }

      if (response.ok) {
        res.json({ account, funded: true, alreadyFunded: false });
        return;
      }

      const body = await response.text();
      if (/op_already_exists|createAccountAlreadyExist|already funded/i.test(body)) {
        res.json({ account, funded: true, alreadyFunded: true });
        return;
      }

      throw new AppError("Friendbot could not fund the account", {
        code: "HORIZON_ERROR",
        status: 502,
        retryable: response.status >= 500 || response.status === 429,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
