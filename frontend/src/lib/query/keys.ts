import type { PageQuery } from "@/lib/api/types";

/**
 * Query-key factory. Every React Query key in the app comes from here so
 * invalidation stays predictable:
 *
 *   [domain, scope?, ...params]
 *
 * - `domain` matches the API module (account, config, price, preferences).
 * - Account-scoped keys put the account id second, so
 *   `queryClient.invalidateQueries({ queryKey: queryKeys.account.all(id) })`
 *   refreshes everything for that account after a transaction.
 * - Add new domains here alongside their API module.
 */
export const queryKeys = {
  account: {
    all: (accountId: string) => ["account", accountId] as const,
    detail: (accountId: string) => ["account", accountId, "detail"] as const,
    balances: (accountId: string) => ["account", accountId, "balances"] as const,
    reserves: (accountId: string) => ["account", accountId, "reserves"] as const,
    signers: (accountId: string) => ["account", accountId, "signers"] as const,
    transactions: (accountId: string, page: PageQuery = {}) => ["account", accountId, "transactions", page] as const,
    payments: (accountId: string, page: PageQuery = {}) => ["account", accountId, "payments", page] as const,
    activity: (accountId: string, page: PageQuery = {}) => ["account", accountId, "activity", page] as const,
  },
  config: {
    all: () => ["config"] as const,
    app: () => ["config", "app"] as const,
    networkInfo: () => ["config", "network-info"] as const,
    fees: () => ["config", "fees"] as const,
    flags: () => ["config", "flags"] as const,
  },
  price: {
    all: () => ["price"] as const,
    many: (assets: string[]) => ["price", "many", [...assets].sort()] as const,
    history: (asset: string, range: string) => ["price", "history", asset, range] as const,
  },
  preferences: {
    all: (accountId: string) => ["preferences", accountId] as const,
  },
  email: {
    all: (accountId: string) => ["email", accountId] as const,
  },
} as const;
