import { env } from "@/lib/env";
import { createApiClient } from "./client";
import { accountApi } from "./endpoints/account";
import { assetsApi } from "./endpoints/assets";
import { authApi } from "./endpoints/auth";
import { configApi } from "./endpoints/config";
import { devApi } from "./endpoints/dev";
import { devicesApi } from "./endpoints/devices";
import { emailApi } from "./endpoints/email";
import { pendingTxsApi } from "./endpoints/pendingTxs";
import { preferencesApi } from "./endpoints/preferences";
import { priceApi } from "./endpoints/price";
import { transactionsApi } from "./endpoints/transactions";
import { WebStorageTokenStore } from "./tokens";

export * from "./client";
export * from "./errors";
export * from "./tokens";
export type * from "./types";

const sessionExpiredListeners = new Set<() => void>();

/** Subscribe to "the refresh token was rejected" events (AuthProvider shows a toast). */
export function onSessionExpired(listener: () => void): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

/** Session tokens live in sessionStorage: they end with the tab. */
export const tokenStore = new WebStorageTokenStore(() =>
  typeof window === "undefined" ? undefined : window.sessionStorage,
);

/** The app-wide API client, configured from NEXT_PUBLIC_* env vars. */
export const apiClient = createApiClient({
  baseUrl: env.apiUrl,
  timeoutMs: env.apiTimeoutMs,
  tokens: tokenStore,
  onSessionExpired: () => sessionExpiredListeners.forEach((listener) => listener()),
});

/** Typed endpoint modules, one per backend route group. */
export const api = {
  auth: authApi(apiClient),
  account: accountApi(apiClient),
  assets: assetsApi(apiClient),
  config: configApi(apiClient),
  dev: devApi(apiClient),
  devices: devicesApi(apiClient),
  email: emailApi(apiClient),
  pendingTxs: pendingTxsApi(apiClient),
  preferences: preferencesApi(apiClient),
  price: priceApi(apiClient),
  transactions: transactionsApi(apiClient),
};
