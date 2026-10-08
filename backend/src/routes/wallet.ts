import { Router, Request, Response, NextFunction } from "express";
import { body, param } from "express-validator";
import { jwtAuth } from "../middleware/jwtAuth";
import { assertValidRequest } from "../middleware/requestValidation";
import { logKeypairIssuance } from "../services/auditLog";
import { StellarService } from "../services/stellar";
import { isGAddress, publicKeyMessage, destinationMessage } from "../utils/stellarAddress";
import { validatePathAssets } from "../validation/stellarAsset";
import * as StellarSdk from "@stellar/stellar-sdk";
import { getCachedResult, cacheResult } from "../services/idempotency";

async function handleIdempotentRequest(
  req: Request,
  res: Response,
  next: NextFunction,
  secretKey: string | undefined,
  execute: () => Promise<{ hash: string; successful: boolean }>
) {
  try {
    assertValidRequest(req);
    const idempotencyKey = req.body.idempotencyKey;
    let sourcePublicKey: string | undefined;

    if (idempotencyKey && secretKey) {
      const keypair = StellarSdk.Keypair.fromSecret(secretKey);
      sourcePublicKey = keypair.publicKey();
      const cached = await getCachedResult(sourcePublicKey, idempotencyKey);
      if (cached) {
        res.json({ hash: cached.hash, successful: cached.successful });
        return;
      }
    }

    const result = await execute();

    if (idempotencyKey && sourcePublicKey) {
      await cacheResult(sourcePublicKey, idempotencyKey, result.hash, result.successful);
    }

    res.json({ hash: result.hash, successful: result.successful });
  } catch (err) {
    next(err);
  }
}

export function createWalletRouter(stellar: StellarService): Router {
  const walletRouter = Router();

  walletRouter.use(jwtAuth);

  walletRouter.post(
    "/send",
    body("sourceSecretKey").isLength({ min: 56, max: 56 }),
    body("destinationPublicKey")
      .isLength({ min: 56, max: 56 })
      .bail()
      .custom(isGAddress)
      .withMessage(destinationMessage),
    body("amount").isDecimal({ decimal_digits: "0,7" }),
    body("asset").optional().isString(),
    body("memo").optional().isString().isLength({ max: 28 }),
    body("idempotencyKey").optional().isString().isLength({ max: 255 }),
    (req, res, next) =>
      handleIdempotentRequest(req, res, next, req.body.sourceSecretKey, () => stellar.sendPayment(req.body))
  );

  walletRouter.post(
    "/fee-bump",
    body("transactionXdr").isString().notEmpty(),
    body("feeSecretKey").isLength({ min: 56, max: 56 }),
    body("fee").optional().isDecimal({ decimal_digits: "0,7" }),
    body("idempotencyKey").optional().isString().isLength({ max: 255 }),
    (req, res, next) =>
      handleIdempotentRequest(req, res, next, req.body.feeSecretKey, () => stellar.feeBumpTransaction(req.body))
  );

  walletRouter.post(
    "/path-payment-strict-send",
    body("sourceSecretKey").isLength({ min: 56, max: 56 }),
    body("destinationPublicKey")
      .isLength({ min: 56, max: 56 })
      .bail()
      .custom(isGAddress)
      .withMessage(destinationMessage),
    body("sendAmount").isDecimal({ decimal_digits: "0,7" }),
    body("destAsset").isString(),
    body("destMin").isDecimal({ decimal_digits: "0,7" }),
    body("path").optional().custom((path: unknown) => {
      if (!Array.isArray(path)) {
        throw new Error("Path must be an array");
      }
      validatePathAssets(path);
      return true;
    }),
    body("memo").optional().isString().isLength({ max: 28 }),
    body("idempotencyKey").optional().isString().isLength({ max: 255 }),
    (req, res, next) =>
      handleIdempotentRequest(req, res, next, req.body.sourceSecretKey, () => stellar.pathPaymentStrictSend(req.body))
  );

  walletRouter.post(
    "/path-payment-strict-receive",
    body("sourceSecretKey").isLength({ min: 56, max: 56 }),
    body("destinationPublicKey")
      .isLength({ min: 56, max: 56 })
      .bail()
      .custom(isGAddress)
      .withMessage(destinationMessage),
    body("destAmount").isDecimal({ decimal_digits: "0,7" }),
    body("destAsset").isString(),
    body("sendMax").isDecimal({ decimal_digits: "0,7" }),
    body("path").optional().custom((path: unknown) => {
      if (!Array.isArray(path)) {
        throw new Error("Path must be an array");
      }
      validatePathAssets(path);
      return true;
    }),
    body("memo").optional().isString().isLength({ max: 28 }),
    body("idempotencyKey").optional().isString().isLength({ max: 255 }),
    (req, res, next) =>
      handleIdempotentRequest(req, res, next, req.body.sourceSecretKey, () => stellar.pathPaymentStrictReceive(req.body))
  );

  walletRouter.post(
    "/paths/strict-send",
    body("sourceAmount").isDecimal({ decimal_digits: "0,7" }),
    body("sourceAsset").optional().isString(),
    body("destinationAsset").isString(),
    body("destinationPublicKey")
      .optional()
      .isLength({ min: 56, max: 56 })
      .bail()
      .custom(isGAddress)
      .withMessage(destinationMessage),
    async (req, res, next) => {
      try {
        assertValidRequest(req);
        const paths = await stellar.findStrictSendPaths(req.body);
        res.json({ paths });
      } catch (err) {
        next(err);
      }
    }
  );

  walletRouter.post(
    "/paths/strict-receive",
    body("destinationAmount").isDecimal({ decimal_digits: "0,7" }),
    body("destinationAsset").isString(),
    body("sourceAsset").optional().isString(),
    body("destinationPublicKey")
      .optional()
      .isLength({ min: 56, max: 56 })
      .bail()
      .custom(isGAddress)
      .withMessage(destinationMessage),
    async (req, res, next) => {
      try {
        assertValidRequest(req);
        const paths = await stellar.findStrictReceivePaths(req.body);
        res.json({ paths });
      } catch (err) {
        next(err);
      }
    }
  );

  walletRouter.post(
    "/partial-transaction",
    body("sourceSecretKey").isLength({ min: 56, max: 56 }),
    body("destinationPublicKey")
      .isLength({ min: 56, max: 56 })
      .bail()
      .custom(isGAddress)
      .withMessage(destinationMessage),
    body("amount").isDecimal({ decimal_digits: "0,7" }),
    body("asset").optional().isString(),
    body("memo").optional().isString().isLength({ max: 28 }),
    async (req, res, next) => {
      try {
        assertValidRequest(req);
        const result = await stellar.buildPartialTransaction(req.body);
        res.json({ xdr: result.xdr, hash: result.hash });
      } catch (err) {
        next(err);
      }
    }
  );

  walletRouter.post(
    "/submit-multisig",
    body("xdr").isString(),
    body("signerSecretKeys").isArray({ min: 1 }),
    body("signerSecretKeys.*").isLength({ min: 56, max: 56 }),
    body("idempotencyKey").optional().isString().isLength({ max: 255 }),
    (req, res, next) => {
      const firstSigner = Array.isArray(req.body.signerSecretKeys) ? req.body.signerSecretKeys[0] : undefined;
      handleIdempotentRequest(req, res, next, firstSigner, () => stellar.submitWithAdditionalSignatures(req.body));
    }
  );

  walletRouter.get(
    "/:publicKey/thresholds",
    param("publicKey").custom(isGAddress).withMessage(publicKeyMessage),
    async (req, res, next) => {
      try {
        assertValidRequest(req);
        const result = await stellar.getAccountThresholds(req.params.publicKey);
        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  walletRouter.post("/keypair", async (req, res, next) => {
    try {
      const keypair = stellar.generateKeypair();
      const publicKey = keypair.publicKey();
      const secretKey = keypair.secret();
      await logKeypairIssuance(req.header("x-api-key") ?? "", publicKey);
      res.json({ publicKey, secretKey });
    } catch (err) {
      next(err);
    }
  });

  return walletRouter;
}
