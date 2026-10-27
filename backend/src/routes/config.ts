import { Router } from "express";
import { API_VERSION, config } from "../config";
import { GlobeWalletContract } from "../services/contracts/globeWallet";

/**
 * Returns runtime environment configuration and contract state (#81).
 * Exposes network parameters, Horizon/RPC URLs, and pending upgrade timelock state.
 */
export function createConfigRouter(globeWallet?: GlobeWalletContract): Router {
  const router = Router();

  router.get("/", async (_req, res, next) => {
    try {
      let pendingUpgrade = null;
      if (globeWallet && config.GLOBE_WALLET_CONTRACT_ID) {
        try {
          pendingUpgrade = await globeWallet.getPendingUpgrade();
        } catch {
          pendingUpgrade = null;
        }
      }

      res.setHeader("Cache-Control", "public, max-age=60");
      res.json({
        network: config.STELLAR_NETWORK,
        networkPassphrase: config.NETWORK_PASSPHRASE,
        horizonUrl: config.HORIZON_URL,
        sorobanRpcUrl: config.SOROBAN_RPC_URL,
        contracts: {
          globeWallet: {
            contractId: config.GLOBE_WALLET_CONTRACT_ID || null,
            pendingUpgrade,
          },
          tokenWrapper: config.TOKEN_WRAPPER_CONTRACT_ID || null,
        },
        features: { contract: Boolean(config.GLOBE_WALLET_CONTRACT_ID) },
        apiVersion: API_VERSION,
        minClientVersion: config.MIN_CLIENT_VERSION,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
