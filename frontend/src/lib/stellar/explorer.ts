import { env, type StellarNetwork } from "@/lib/env";

/** stellar.expert path segment per network. */
const EXPLORER_SEGMENT: Record<StellarNetwork, string> = {
  testnet: "testnet",
  mainnet: "public",
  futurenet: "futurenet",
};

export type ExplorerEntity = "tx" | "account" | "asset" | "contract" | "ledger";

/** Link to a block-explorer page, e.g. explorerUrl("tx", hash). */
export function explorerUrl(
  entity: ExplorerEntity,
  id: string | number,
  network: StellarNetwork = env.network,
  base: string = env.explorerUrl,
): string {
  return `${base}/${EXPLORER_SEGMENT[network]}/${entity}/${encodeURIComponent(String(id))}`;
}

export const txUrl = (hash: string, network?: StellarNetwork) => explorerUrl("tx", hash, network);
export const accountUrl = (id: string, network?: StellarNetwork) => explorerUrl("account", id, network);
