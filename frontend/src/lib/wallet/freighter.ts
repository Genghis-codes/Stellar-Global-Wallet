import {
  getAddress,
  getNetworkDetails,
  isAllowed,
  isConnected,
  requestAccess,
  signTransaction,
  WatchWalletChanges,
} from "@stellar/freighter-api";
import { WalletError, type WalletAdapter, type WalletNetwork } from "./types";

/** How often Freighter is polled for account/network switches. */
const WATCH_INTERVAL_MS = 3000;

interface FreighterError {
  code?: number;
  message?: string;
}

/** Translate a Freighter `error` field into a WalletError. */
export function toWalletError(error: FreighterError | string | undefined, fallback: string): WalletError {
  const message = (typeof error === "string" ? error : error?.message) || fallback;
  if (/declin|reject|denied|cancel/i.test(message)) {
    return new WalletError("USER_REJECTED", "The request was rejected in Freighter.");
  }
  if (/not (installed|connected)|no freighter/i.test(message)) {
    return new WalletError("NOT_INSTALLED", "Freighter is not installed or is locked.");
  }
  return new WalletError("UNKNOWN", message);
}

async function ensureInstalled(): Promise<void> {
  const result = await isConnected();
  if (result.error || !result.isConnected) {
    throw new WalletError("NOT_INSTALLED", "Freighter is not installed. Install the extension and reload the page.");
  }
}

export const freighter: WalletAdapter = {
  id: "freighter",
  name: "Freighter",
  installUrl: "https://www.freighter.app/",

  async isAvailable() {
    try {
      const result = await isConnected();
      return !result.error && result.isConnected;
    } catch {
      return false;
    }
  },

  async connect() {
    await ensureInstalled();
    const result = await requestAccess();
    if (result.error) throw toWalletError(result.error, "Could not connect to Freighter.");
    if (!result.address) throw new WalletError("NO_ACCOUNT", "Freighter did not share an account.");
    return result.address;
  },

  async getAddress() {
    const allowed = await isAllowed();
    if (allowed.error || !allowed.isAllowed) return null;
    const result = await getAddress();
    if (result.error) throw toWalletError(result.error, "Could not read the Freighter account.");
    return result.address || null;
  },

  async getNetwork(): Promise<WalletNetwork> {
    const result = await getNetworkDetails();
    if (result.error) throw toWalletError(result.error, "Could not read the Freighter network.");
    return {
      network: result.network,
      networkPassphrase: result.networkPassphrase,
      horizonUrl: result.networkUrl,
      sorobanRpcUrl: result.sorobanRpcUrl,
    };
  },

  async signTransaction(xdr, opts) {
    const result = await signTransaction(xdr, opts);
    if (result.error) throw toWalletError(result.error, "Freighter could not sign the transaction.");
    if (!result.signedTxXdr) throw new WalletError("UNKNOWN", "Freighter returned no signed transaction.");
    return result.signedTxXdr;
  },

  watch(listener) {
    const watcher = new WatchWalletChanges(WATCH_INTERVAL_MS);
    watcher.watch(({ address, networkPassphrase, error }) => {
      if (!error && address) listener({ address, networkPassphrase });
    });
    return () => watcher.stop();
  },
};
