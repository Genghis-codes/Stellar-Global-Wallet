import { networkFromPassphrase, NETWORK_LABELS } from "@/lib/stellar/network";
import { WalletError, type WalletAdapter, type WalletNetwork } from "./types";

export interface NetworkCheck {
  ok: boolean;
  wallet: WalletNetwork;
  /** Human-readable name of the wallet's network. */
  walletLabel: string;
}

/** Compare the wallet's network with the passphrase the app/backend expects. */
export async function checkWalletNetwork(adapter: WalletAdapter, expectedPassphrase: string): Promise<NetworkCheck> {
  const wallet = await adapter.getNetwork();
  const known = networkFromPassphrase(wallet.networkPassphrase);
  return {
    ok: wallet.networkPassphrase === expectedPassphrase,
    wallet,
    walletLabel: known ? NETWORK_LABELS[known] : wallet.network || "a custom network",
  };
}

/** Throws WRONG_NETWORK when the wallet is on another network. */
export async function assertWalletNetwork(adapter: WalletAdapter, expectedPassphrase: string): Promise<void> {
  const check = await checkWalletNetwork(adapter, expectedPassphrase);
  if (!check.ok) {
    const expected = networkFromPassphrase(expectedPassphrase);
    throw new WalletError(
      "WRONG_NETWORK",
      `${adapter.name} is on ${check.walletLabel}. Switch it to ${expected ? NETWORK_LABELS[expected] : "the expected network"} and try again.`,
    );
  }
}
