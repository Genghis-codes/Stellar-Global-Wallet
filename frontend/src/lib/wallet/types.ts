/**
 * Wallet abstraction. The app talks to a WalletAdapter, never to an
 * extension SDK directly, so other wallets can be added next to Freighter.
 */

export type WalletErrorCode = "NOT_INSTALLED" | "USER_REJECTED" | "WRONG_NETWORK" | "NO_ACCOUNT" | "UNKNOWN";

export class WalletError extends Error {
  readonly code: WalletErrorCode;

  constructor(code: WalletErrorCode, message: string) {
    super(message);
    this.name = "WalletError";
    this.code = code;
  }
}

export function isWalletError(value: unknown): value is WalletError {
  return value instanceof WalletError;
}

export interface WalletNetwork {
  /** Wallet's own network name (e.g. "TESTNET", "PUBLIC"). */
  network: string;
  networkPassphrase: string;
  horizonUrl?: string;
  sorobanRpcUrl?: string;
}

/** Wallet state pushed by `watch` when the user switches account or network. */
export interface WalletState {
  address: string;
  networkPassphrase: string;
}

export interface WalletAdapter {
  readonly id: string;
  readonly name: string;
  /** URL where users can install the wallet. */
  readonly installUrl: string;
  /** The extension is installed and reachable. */
  isAvailable(): Promise<boolean>;
  /** Ask the user to share their account; resolves to the G... address. */
  connect(): Promise<string>;
  /** The currently shared account, or null if the site is not allowed yet. */
  getAddress(): Promise<string | null>;
  getNetwork(): Promise<WalletNetwork>;
  /** Sign a base64 transaction envelope; resolves to the signed XDR. */
  signTransaction(xdr: string, opts: { networkPassphrase: string; address?: string }): Promise<string>;
  /** Optional: report account/network switches made in the wallet. Returns a stop function. */
  watch?(listener: (state: WalletState) => void): () => void;
}
