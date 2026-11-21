import { AsyncLocalStorage } from "node:async_hooks";
import type { QueryResult, QueryResultRow } from "pg";

export interface MinimalQueryable {
  query<R extends QueryResultRow = any>(
    queryTextOrConfig: string,
    values?: any[]
  ): Promise<QueryResult<R>>;
}

export interface RlsExecutionContext {
  mode: "account" | "service";
  account?: string;
  jobName?: string;
  client?: MinimalQueryable;
  poolRef?: unknown;
}

export const rlsStorage = new AsyncLocalStorage<RlsExecutionContext>();

/** Returns a snapshot of the active RLS context on the current async call chain, if any. */
export function getCurrentRlsContext(): RlsExecutionContext | undefined {
  return rlsStorage.getStore();
}

/**
 * Binds `account` (`req.user.sub`) to the async execution context for the
 * lifetime of an HTTP request. Any subsequent `pool.query(...)` or
 * `withAccountContext(account, ...)` inside `fn` automatically executes inside
 * a transaction with `app.account` set via `SET LOCAL` (`set_config(..., true)`).
 */
export function runWithRequestAccount<T>(account: string, fn: () => T): T {
  if (!account || typeof account !== "string" || account.trim().length === 0) {
    throw new Error("runWithRequestAccount requires a non-empty account identifier");
  }
  return rlsStorage.run({ mode: "account", account }, fn);
}
