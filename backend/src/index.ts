import "dotenv/config";
import { config } from "./config";
import { createApp } from "./app";
import { ensureAuditTable, pool } from "./db";
import { initKeys } from "./utils/jwtKeys";
import { BuiltTransactionRegistry, PgBuiltTransactionStore } from "./services/builtTransactions";
import { StellarService } from "./services/stellar";
import { createAccountLock } from "./services/locks/createAccountLock";
import { startPaymentNotifier } from "./services/paymentNotifier";
import { startRecoveryNotifier } from "./services/recoveryNotifier";
import { getVerifiedAssets } from "./services/verifiedAssets";
import { startTtlKeeper } from "./services/ttlKeeper";
import { startUpgradeWatcher } from "./services/upgradeWatcher";
import { startInvalidationListener } from "./services/sorobanCache";
import { startActivityFeedIndexer } from "./services/activityFeed";
import { shutdownManager } from "./services/shutdown";
import { assertNetworkConfigurationMatches } from "./utils/networkCheck";

// A rejected promise nobody awaited (e.g. a fire-and-forget cache bust or
// notifier call) would otherwise crash the process on Node >= 15 with no
// context. Log it with its stack and keep serving; a synchronous uncaught
// exception leaves state unknown, so log and exit for the orchestrator.
process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandled promise rejection", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[process] uncaught exception, exiting", err);
  process.exit(1);
});

async function main() {
  // #223 — Multi-network safety: verify Horizon and Soroban RPC endpoints match config
  if (config.NODE_ENV !== "test") {
    try {
      const netInfo = await assertNetworkConfigurationMatches();
      console.log(
        `[network-check] Verified network matches ${netInfo.expectedNetwork} ("${netInfo.horizonPassphrase}")`
      );
    } catch (err) {
      console.error("[network-check] Fatal network mismatch error:", (err as Error).message);
      process.exit(1);
    }
  }

  // #54 — fail fast on a malformed verified-asset list rather than on the
  // first request that needs it.
  getVerifiedAssets();

  const { lock, shutdown } = await createAccountLock();
  // #194 — /wallet/submit only relays envelopes built by this API.
  const builtTxs = new BuiltTransactionRegistry(new PgBuiltTransactionStore(pool), config.NETWORK_PASSPHRASE);
  const stellar = new StellarService(lock, builtTxs);
  const app = createApp(stellar);

  await ensureAuditTable();
  // #199 — load (or generate on first boot) asymmetric JWT signing keys.
  await initKeys();

  const server = app.listen(config.PORT, () => {
    console.log(
      `GlobeWallet API running on port ${config.PORT} (lock backend: ${config.LOCK_BACKEND})`
    );
  });

  // #88 — incoming-payment push notifications (fire-and-forget worker).
  void startPaymentNotifier().catch((err: Error) => {
    console.error("[payment-notifier] fatal error", err.message);
  });

  // #89 — recovery/guardian event push notifications (fire-and-forget worker).
  void startRecoveryNotifier().catch((err: Error) => {
    console.error("[recovery-notifier] fatal error", err.message);
  });

  // #86 — start cross-instance cache invalidation listener.
  void startInvalidationListener().catch((err: Error) => {
    console.error("[soroban-cache] failed to start invalidation listener", err.message);
  });

  // #79 — activity feed indexer for contract events
  let stopActivityFeedIndexer: () => void = () => {};
  void startActivityFeedIndexer(stellar)
    .then((stop) => {
      stopActivityFeedIndexer = stop;
    })
    .catch((err: Error) => {
      console.error("[activity-feed] failed to start indexer", err.message);
    });

  // #185 — keep active wallets' persistent entries from archiving.
  const stopTtlKeeper = startTtlKeeper();
  // #186 — announce proposed/executed contract upgrades.
  const stopUpgradeWatcher = startUpgradeWatcher();

  const shutdownGracefully = async (signal: string) => {
    console.log(`[shutdown] ${signal} received, beginning graceful shutdown`);
    await shutdownManager.initiateShutdown(server, {
      timeoutMs: config.SHUTDOWN_TIMEOUT_MS,
      onDrainStart: () => {
        stopActivityFeedIndexer();
        stopTtlKeeper();
        stopUpgradeWatcher();
      },
      onDrainComplete: async () => {
        try {
          await shutdown();
        } catch (err) {
          console.error("[shutdown] Error releasing account locks:", err);
        }
        try {
          await pool.end();
        } catch (err) {
          console.error("[shutdown] Error closing database pool:", err);
        }
        process.exit(0);
      },
    });
  };

  process.on("SIGTERM", () => void shutdownGracefully("SIGTERM"));
  process.on("SIGINT", () => void shutdownGracefully("SIGINT"));
}

main().catch((err) => {
  console.error("Failed to start GlobeWallet API", err);
  process.exit(1);
});
