/**
 * Typed access to the public runtime configuration (NEXT_PUBLIC_* vars).
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_X` at build time only when it is
 * referenced literally, so every variable is read by name below.
 */

export type StellarNetwork = "testnet" | "mainnet" | "futurenet";

export interface AppEnv {
  apiUrl: string;
  network: StellarNetwork;
  horizonUrl: string;
  explorerUrl: string;
  apiTimeoutMs: number;
}

const NETWORKS: readonly StellarNetwork[] = ["testnet", "mainnet", "futurenet"];

const DEFAULT_HORIZON: Record<StellarNetwork, string> = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
  futurenet: "https://horizon-futurenet.stellar.org",
};

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function parseNetwork(value: string | undefined): StellarNetwork {
  const normalised = (value ?? "").trim().toLowerCase();
  if (normalised === "public" || normalised === "pubnet") return "mainnet";
  return (NETWORKS as readonly string[]).includes(normalised) ? (normalised as StellarNetwork) : "testnet";
}

export function parseTimeout(value: string | undefined, fallback = 15_000): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function readEnv(source: Record<string, string | undefined>): AppEnv {
  const network = parseNetwork(source.NEXT_PUBLIC_STELLAR_NETWORK);
  return {
    apiUrl: trimSlash(source.NEXT_PUBLIC_API_URL || "http://localhost:4000"),
    network,
    horizonUrl: trimSlash(source.NEXT_PUBLIC_HORIZON_URL || DEFAULT_HORIZON[network]),
    explorerUrl: trimSlash(source.NEXT_PUBLIC_EXPLORER_URL || "https://stellar.expert/explorer"),
    apiTimeoutMs: parseTimeout(source.NEXT_PUBLIC_API_TIMEOUT_MS),
  };
}

export const env: AppEnv = readEnv({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
  NEXT_PUBLIC_HORIZON_URL: process.env.NEXT_PUBLIC_HORIZON_URL,
  NEXT_PUBLIC_EXPLORER_URL: process.env.NEXT_PUBLIC_EXPLORER_URL,
  NEXT_PUBLIC_API_TIMEOUT_MS: process.env.NEXT_PUBLIC_API_TIMEOUT_MS,
});
