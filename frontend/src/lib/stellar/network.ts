import { Networks } from "@stellar/stellar-sdk";
import { env, type StellarNetwork } from "@/lib/env";

/** Network passphrase for each supported network. */
export const NETWORK_PASSPHRASES: Record<StellarNetwork, string> = {
  testnet: Networks.TESTNET,
  mainnet: Networks.PUBLIC,
  futurenet: Networks.FUTURENET,
};

export const NETWORK_LABELS: Record<StellarNetwork, string> = {
  testnet: "Testnet",
  mainnet: "Mainnet",
  futurenet: "Futurenet",
};

export function networkPassphrase(network: StellarNetwork = env.network): string {
  return NETWORK_PASSPHRASES[network];
}

/** Which known network a passphrase belongs to, or null for custom networks. */
export function networkFromPassphrase(passphrase: string): StellarNetwork | null {
  const entry = Object.entries(NETWORK_PASSPHRASES).find(([, value]) => value === passphrase);
  return entry ? (entry[0] as StellarNetwork) : null;
}

export function isTestNetwork(network: StellarNetwork = env.network): boolean {
  return network !== "mainnet";
}
