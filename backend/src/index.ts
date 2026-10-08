import "dotenv/config";
import { config } from "./config";
import { createApp } from "./app";
import { ensureAuditTable } from "./db";
import { StellarService } from "./services/stellar";
import { createAccountLock } from "./services/locks/createAccountLock";

async function main() {
  const { lock, shutdown } = await createAccountLock();
  const stellar = new StellarService(lock);
  const app = createApp(stellar);

  await ensureAuditTable();

  const server = app.listen(config.PORT, () => {
    console.log(
      `GlobeWallet API running on port ${config.PORT} (lock backend: ${config.LOCK_BACKEND})`
    );
  });

  const shutdownGracefully = async (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await shutdown();
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => void shutdownGracefully("SIGTERM"));
  process.on("SIGINT", () => void shutdownGracefully("SIGINT"));
}

main().catch((err) => {
  console.error("Failed to start GlobeWallet API", err);
  process.exit(1);
});
