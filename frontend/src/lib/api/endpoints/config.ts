import type { ApiClient } from "../client";

/**
 * Server metadata the app reads before (and independent of) sign-in:
 * /api/v1/config, /api/v1/network, /api/v1/flags and /api/v1/health.
 * All public and unauthenticated.
 */

export interface PendingUpgrade {
  wasmHash: string;
  proposedBy: string;
  readyAtLedger: number;
  executableAt: string | null;
}

/** GET /api/v1/config (backend/src/routes/config.ts, #81). */
export interface AppConfigResponse {
  network: string;
  networkPassphrase: string;
  horizonUrl: string;
  sorobanRpcUrl: string;
  contracts: {
    globeWallet: { contractId: string | null; pendingUpgrade: PendingUpgrade | null };
    tokenWrapper: string | null;
  };
  features: { contract: boolean };
  apiVersion: string;
  minClientVersion?: string;
}

export interface FeeEstimate {
  stroops: string;
  xlm: string;
}

/** GET /api/v1/network/fees (#13). */
export interface NetworkFeesResponse {
  low: FeeEstimate;
  normal: FeeEstimate;
  high: FeeEstimate;
  ledgerCapacityUsage: string;
  source: "horizon" | "fallback";
}

/** GET /api/v1/network/info (#223). */
export interface NetworkInfoResponse {
  network: string;
  networkPassphrase: string;
  sorobanNetworkPassphrase: string;
  horizonUrl: string;
  sorobanRpcUrl: string;
}

/** GET /api/v1/flags — backend/src/services/featureFlags.ts. */
export interface FeatureFlags {
  multisig: boolean;
  feeBump: boolean;
  pathPayments: boolean;
  recovery: boolean;
  priceOracle: boolean;
}

interface DependencyCheck {
  ok: boolean;
  latencyMs: number;
  skipped?: boolean;
  error?: string;
}

/** GET /api/v1/health/details (#30); 503 when Horizon or RPC is down. */
export interface HealthDetails {
  status: "ok" | "degraded" | "down";
  checks: { horizon: DependencyCheck; rpc: DependencyCheck; postgres: DependencyCheck; redis: DependencyCheck };
}

export function configApi(client: ApiClient) {
  return {
    get(signal?: AbortSignal) {
      return client.get<AppConfigResponse>("/api/v1/config", { auth: false, signal });
    },

    networkInfo(signal?: AbortSignal) {
      return client.get<NetworkInfoResponse>("/api/v1/network/info", { auth: false, signal });
    },

    fees(signal?: AbortSignal) {
      return client.get<NetworkFeesResponse>("/api/v1/network/fees", { auth: false, signal });
    },

    async flags(signal?: AbortSignal): Promise<FeatureFlags> {
      const { flags } = await client.get<{ flags: FeatureFlags }>("/api/v1/flags", { auth: false, signal });
      return flags;
    },

    /** Liveness: GET /health → { status: "ok" }. */
    health(signal?: AbortSignal) {
      return client.get<{ status: "ok" }>("/health", { auth: false, signal });
    },

    healthDetails(signal?: AbortSignal) {
      return client.get<HealthDetails>("/api/v1/health/details", { auth: false, signal });
    },
  };
}

export type ConfigApi = ReturnType<typeof configApi>;
