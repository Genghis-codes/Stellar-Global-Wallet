import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import { rateLimit } from "express-rate-limit";
import { createWalletRouter } from "./routes/wallet";
import { createAccountRouter } from "./routes/account";
import { createContractRouter } from "./routes/contract";
import { priceRouter } from "./routes/price";
import { authRouter } from "./routes/auth";
import { errorHandler } from "./middleware/errorHandler";
import { config } from "./config";
import { StellarService } from "./services/stellar";
import { SorobanService } from "./services/soroban";
import { GlobeWalletContract } from "./services/contracts/globeWallet";
import { NotFoundError } from "./errors/appError";

export function createApp(
  stellar: StellarService = new StellarService(),
  globeWallet: GlobeWalletContract = new GlobeWalletContract(new SorobanService())
) {
  const app = express();

  // Must be set before any middleware that reads req.ip (rate limiter
  // below, and anything else added later) — see issue #90. The hop count
  // is configured via TRUST_PROXY_HOPS (config.ts) rather than hardcoded
  // `true`, since trusting the entire X-Forwarded-For chain unconditionally
  // lets a client spoof their apparent IP if there's more than one real
  // proxy hop between them and this process.
  app.set("trust proxy", config.TRUST_PROXY_HOPS);

  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGIN.split(",") }));
  app.use(morgan("combined"));
  app.use(express.json({ limit: "10kb" }));

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 min
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // Health
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // Routes
  app.use("/api/v1/wallet", createWalletRouter(stellar));
  app.use("/api/v1/account", createAccountRouter(stellar));
  app.use("/api/v1/contract", createContractRouter(globeWallet));
  app.use("/api/v1/price", priceRouter);
  app.use("/api/v1/auth", authRouter);

  app.use((req, _res, next) => {
    next(
      new NotFoundError(
        `Route ${req.method} ${req.originalUrl} was not found`,
        "ROUTE_NOT_FOUND"
      )
    );
  });

  app.use(errorHandler);

  return app;
}
