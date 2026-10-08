import { Router } from "express";
import { body, param } from "express-validator";
import { assertValidRequest } from "../middleware/requestValidation";
import { GlobeWalletContract } from "../services/contracts/globeWallet";
import { jwtAuth } from "../middleware/jwtAuth";
import { isGAddress, publicKeyMessage } from "../utils/stellarAddress";

export function createContractRouter(globeWallet: GlobeWalletContract): Router {
  const contractRouter = Router();

  contractRouter.get(
    "/wallet/:publicKey/assets",
    param("publicKey")
      .isLength({ min: 56, max: 56 })
      .bail()
      .custom(isGAddress)
      .withMessage(publicKeyMessage),
    async (req, res, next) => {
      try {
        assertValidRequest(req);
        const assets = await globeWallet.getAssets(req.params.publicKey);
        res.json({ assets });
      } catch (err) {
        next(err);
      }
    }
  );

  contractRouter.use(jwtAuth);

  contractRouter.post(
    "/wallet/spend",
    body("userSecretKey").isLength({ min: 56, max: 56 }),
    body("assetCode").isString().isLength({ min: 1, max: 12 }),
    body("amount").isNumeric(),
    async (req, res, next) => {
      try {
        assertValidRequest(req);
        const { userSecretKey, assetCode, amount } = req.body;
        const result = await globeWallet.recordSpend({ userSecretKey, assetCode, amount });
        res.json({ hash: result.hash, ledger: result.ledger, successful: true });
      } catch (err) {
        next(err);
      }
    }
  );

  return contractRouter;
}
