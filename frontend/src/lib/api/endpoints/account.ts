import type { ApiClient } from "../client";
import type { AccountId, Page, PageQuery } from "../types";

/**
 * /api/v1/account — read endpoints for any Stellar account
 * (backend/src/routes/account.ts). Reads are public; the CSV export and the
 * ".../build" routes need a session for the same account.
 */

/** One trustline/native balance as Horizon returns it (subset). */
export interface HorizonBalanceLine {
  asset_type: "native" | "credit_alphanum4" | "credit_alphanum12" | "liquidity_pool_shares";
  balance: string;
  asset_code?: string;
  asset_issuer?: string;
  liquidity_pool_id?: string;
  limit?: string;
  buying_liabilities?: string;
  selling_liabilities?: string;
  is_authorized?: boolean;
}

/** GET /:publicKey — the Horizon account record (fields the app uses). */
export interface AccountRecord {
  id: string;
  account_id: string;
  sequence: string;
  subentry_count: number;
  balances: HorizonBalanceLine[];
  signers: Array<{ key: string; weight: number; type: string }>;
  thresholds: { low_threshold: number; med_threshold: number; high_threshold: number };
  home_domain?: string;
  num_sponsoring?: number;
  num_sponsored?: number;
  [key: string]: unknown;
}

/** GET /:publicKey/balances — asset code -> balance ("XLM" for native). */
export interface BalancesResponse {
  balances: Record<string, string>;
}

export interface ReserveBreakdown {
  baseReserve: string;
  subentryCount: number;
  numSponsoring: number;
  numSponsored: number;
  minimumBalance: string;
  sellingLiabilities: string;
  spendable: string;
}

/** GET /:publicKey/reserves — reserves plus every balance line with its spendable amount. */
export interface ReservesResponse {
  reserves: ReserveBreakdown;
  balances: Array<HorizonBalanceLine & { spendable: string }>;
}

/** GET /:publicKey/signers */
export interface MultisigInfo {
  account: string;
  signers: Array<{ key: string; weight: number; type: string; isMaster: boolean }>;
  thresholds: { low: number; medium: number; high: number };
  totalWeight: number;
  reachable: { low: boolean; medium: boolean; high: boolean };
  isMultisig: boolean;
}

export interface TransactionSummary {
  id: string;
  hash: string;
  ledger: number;
  created_at: string;
  operation_count: number;
  memo?: string;
}

export interface PaymentHistoryItem {
  id: string;
  type: string;
  transactionHash: string;
  createdAt: string;
  from?: string;
  to?: string;
  amount?: string;
  assetType?: string;
  assetCode?: string;
  assetIssuer?: string;
  memo?: string;
  flags: string[];
  pagingToken?: string;
}

export interface ActivityItem {
  id: string;
  source: "payment" | "contract_event" | "claimable_balance";
  timestamp: string;
  type: string;
  details: Record<string, unknown>;
}

export interface ActivityResponse {
  items: ActivityItem[];
  next?: string;
  hasMore: boolean;
}

export interface MuxedAddressResponse {
  address: string;
  baseAccount: string;
  id: string;
}

export type PagedResponse<T> = Page<T> & { hasMore: boolean };

/** An unsigned transaction from a ".../build" route, ready for the wallet to sign. */
export interface UnsignedTransaction {
  xdr: string;
  networkPassphrase: string;
}

/** GET /:publicKey/claimable-balances item, with predicates evaluated server-side. */
export interface ClaimableBalance {
  /** 72-character hex balance id. */
  id: string;
  /** "native" or "CODE:ISSUER". */
  asset: string;
  amount: string;
  sponsor?: string;
  lastModifiedLedger: number;
  claimants: Array<{ destination: string; predicate: unknown }>;
  claimableNow: boolean;
  claimableAfter?: string;
  claimableBefore?: string;
}

/** POST .../claim/build and .../reclaim/build. */
export interface ClaimBuild extends UnsignedTransaction {
  balanceId: string;
  asset: string;
  amount: string;
  /** The build adds a trustline first because the account doesn't hold the asset. */
  createdTrustline: boolean;
}

/** One step of a close-account build, shown before signing. */
export interface CloseAccountOperation {
  type:
    | "cancelOffer"
    | "revokeSponsorship"
    | "convertBalance"
    | "sendBalance"
    | "removeTrustline"
    | "removeSigner"
    | "removeData"
    | "accountMerge";
  asset?: string;
  amount?: string;
  offerId?: string;
  selling?: string;
  buying?: string;
  expectedXlm?: string;
  minXlm?: string;
  signer?: string;
  name?: string;
  sponsor?: string;
  destination?: string;
}

export interface CloseAccountBuild extends UnsignedTransaction {
  operations: CloseAccountOperation[];
  operationCount: number;
}

/** POST /:publicKey/close/build with `dryRun: true`. */
export interface CloseAccountDryRun extends CloseAccountBuild {
  reserveRecovered: string;
  estimatedReserve: string;
  blocking: Array<{ code: "BALANCE_NOT_DRAINED" | "SPONSORED_TRUSTLINE" | "NO_PATH"; message: string }>;
  canClose: boolean;
  simulation?: { available: boolean; successful?: boolean };
}

const base = (publicKey: AccountId) => `/api/v1/account/${encodeURIComponent(publicKey)}`;

export function accountApi(client: ApiClient) {
  return {
    get(publicKey: AccountId, signal?: AbortSignal) {
      return client.get<AccountRecord>(base(publicKey), { signal });
    },

    balances(publicKey: AccountId, signal?: AbortSignal) {
      return client.get<BalancesResponse>(`${base(publicKey)}/balances`, { signal });
    },

    reserves(publicKey: AccountId, signal?: AbortSignal) {
      return client.get<ReservesResponse>(`${base(publicKey)}/reserves`, { signal });
    },

    signers(publicKey: AccountId, signal?: AbortSignal) {
      return client.get<MultisigInfo>(`${base(publicKey)}/signers`, { signal });
    },

    transactions(publicKey: AccountId, page: PageQuery = {}, signal?: AbortSignal) {
      return client.get<PagedResponse<TransactionSummary>>(`${base(publicKey)}/transactions`, {
        query: { cursor: page.cursor, limit: page.limit },
        signal,
      });
    },

    payments(publicKey: AccountId, page: PageQuery = {}, signal?: AbortSignal) {
      return client.get<PagedResponse<PaymentHistoryItem>>(`${base(publicKey)}/payments`, {
        query: { cursor: page.cursor, limit: page.limit },
        signal,
      });
    },

    activity(publicKey: AccountId, page: PageQuery = {}, signal?: AbortSignal) {
      return client.get<ActivityResponse>(`${base(publicKey)}/activity`, {
        query: { cursor: page.cursor, limit: page.limit },
        signal,
      });
    },

    /** POST /:publicKey/muxed — derive an M... address for a uint64 id. */
    muxed(publicKey: AccountId, id: string | number) {
      return client.post<MuxedAddressResponse>(`${base(publicKey)}/muxed`, { id: String(id) });
    },

    claimableBalances(publicKey: AccountId, page: PageQuery = {}, signal?: AbortSignal) {
      return client.get<PagedResponse<ClaimableBalance>>(`${base(publicKey)}/claimable-balances`, {
        query: { cursor: page.cursor, limit: page.limit },
        signal,
      });
    },

    /** Build a claim (adds the trustline first when needed). */
    buildClaim(publicKey: AccountId, balanceId: string) {
      return client.post<ClaimBuild>(
        `${base(publicKey)}/claimable-balances/${encodeURIComponent(balanceId)}/claim/build`,
      );
    },

    /** Build a reclaim for a balance this account sponsored. */
    buildReclaim(publicKey: AccountId, balanceId: string) {
      return client.post<ClaimBuild>(
        `${base(publicKey)}/claimable-balances/${encodeURIComponent(balanceId)}/reclaim/build`,
      );
    },

    /** Preview the close-account sequence: steps, blocking conditions, recovered XLM. */
    closeDryRun(publicKey: AccountId, destination: AccountId) {
      return client.post<CloseAccountDryRun>(`${base(publicKey)}/close/build`, { destination, dryRun: true });
    },

    /** Build the close-account transaction that merges into `destination`. */
    buildClose(publicKey: AccountId, destination: AccountId) {
      return client.post<CloseAccountBuild>(`${base(publicKey)}/close/build`, { destination });
    },

    /** GET /:publicKey/transactions/export.csv (authenticated) — CSV text. */
    exportCsv(publicKey: AccountId, range: { from?: string; to?: string } = {}) {
      return client.get<string>(`${base(publicKey)}/transactions/export.csv`, {
        query: range,
        responseType: "text",
        headers: { Accept: "text/csv" },
      });
    },
  };
}

export type AccountApi = ReturnType<typeof accountApi>;
