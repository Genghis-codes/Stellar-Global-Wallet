/**
 * Shared domain types used by both the backend API and any future SDK/
 * client packages (web, mobile). This is the single source of truth for
 * these shapes — import from here instead of redeclaring them.
 *
 * NOTE on scope (issue #107): the issue names `TransactionSummary`,
 * `AssetInfo` and `RecoveryProposal` as example types to centralize here.
 * `TransactionSummary` and `AssetInfo` existed as local interfaces in the
 * backend (`services/stellar.ts` and `services/contracts/globeWallet.ts`
 * respectively) and have been moved here, with the backend re-exporting
 * them for backward compatibility. The recovery types (`RecoveryState`
 * and friends) were added with the guardian/recovery read endpoints in
 * issue #51.
 */

/** A single payment/transaction entry as surfaced by the wallet's transaction history. */
export interface TransactionSummary {
  id: string;
  hash: string;
  ledger: number;
  created_at: string;
  operation_count: number;
  memo: string | undefined;
}

/** An asset whitelisted on a user's globe-wallet contract instance. */
export interface AssetInfo {
  code: string;
  issuer: string | null;
}

/** An allowed token with contract address and metadata (issue #82). */
export interface AllowedTokenInfo {
  address: string;
  code?: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  issuer?: string | null;
}

/** Social-recovery parameters (`recovery_config()`), issue #51. */
export interface RecoveryConfigView {
  /** Distinct guardian approvals required to reach quorum. */
  threshold: number;
  /** Ledgers between reaching quorum and `execute_recovery` becoming callable. */
  delayInLedgers: number;
}

/** The active recovery proposal (`recovery_proposal()`) plus derived progress fields, issue #51. */
export interface RecoveryProposalView {
  newAdmin: string;
  /** Guardians who have approved, in approval order. */
  approvals: string[];
  approvalsCount: number;
  /** Null only if recovery config was removed while a proposal exists. */
  threshold: number | null;
  approvalsRemaining: number | null;
  quorumReached: boolean;
  /** Ledger at which execution unlocks; null until quorum is reached. */
  readyAtLedger: number | null;
  /** Latest ledger reported by Soroban RPC; null if RPC couldn't report it. */
  latestLedger: number | null;
  ledgersRemaining: number | null;
  /** Estimated ISO-8601 time execution unlocks (~5s/ledger); null if unknown or not armed. */
  executableAt: string | null;
  /** True when `execute_recovery` would pass its timelock check right now. */
  executable: boolean;
}

/** Everything the recovery/settings screen needs in one response, issue #51. */
export interface RecoveryState {
  guardians: string[];
  guardianCount: number;
  config: RecoveryConfigView | null;
  configured: boolean;
  proposal: RecoveryProposalView | null;
}

/** Remaining daily spend allowance for one asset, issue #50. Amounts are stroop strings. */
export interface SpendAllowance {
  assetCode: string;
  /** True when no limit is configured (contract limit of 0). */
  unlimited: boolean;
  /** Daily cap in stroops; "0" when unlimited. */
  limit: string;
  /** Spent in the current window. Always "0" when unlimited (spends aren't tracked then). */
  spent: string;
  /** `limit - spent`, floored at "0"; null when unlimited. */
  remaining: string | null;
  /** Window start, 00:00:00 UTC by ledger close time. */
  windowStartsAt: string;
  /** When `spent` resets to "0": the next 00:00:00 UTC by ledger close time. */
  windowResetsAt: string;
}

/** One asset search hit for the add-trustline flow, issue #53. */
export interface AssetSearchResult {
  code: string;
  issuer: string;
  /** The issuer's home domain as Horizon reports it; null if unset. */
  homeDomain: string | null;
  /** Accounts with an authorized trustline; null when not looked up (domain search). */
  numAccounts: number | null;
  /** On the deployment's curated verified list. Verified results sort first. */
  verified: boolean;
}

export interface AssetSearchPage {
  results: AssetSearchResult[];
  /** Pass back as `cursor` for the next page; null when there are no more results. */
  nextCursor: string | null;
}

/** Why an asset's metadata fields are (or aren't) populated, issue #52. */
export type AssetMetadataStatus =
  | "ok"
  | "no_home_domain"
  | "invalid_home_domain"
  | "toml_unavailable"
  | "toml_invalid"
  | "currency_not_listed";

/** Display metadata from the issuer's stellar.toml [[CURRENCIES]] entry, issue #52. */
export interface AssetMetadata {
  code: string;
  issuer: string;
  name: string | null;
  desc: string | null;
  /** https-only image URL; anything else is dropped to null. */
  image: string | null;
  /** `display_decimals` (0–7); 7 when not published. */
  decimals: number;
  homeDomain: string | null;
  orgName: string | null;
  status: AssetMetadataStatus;
}

// ---------------------------------------------------------------------------
//  Display-ready transaction history (#59, #60, #61)
// ---------------------------------------------------------------------------

/**
 * An asset as returned by the history/detail endpoints. `id` is the
 * canonical string form used everywhere else in the API (`XLM` for the
 * native asset, `CODE:ISSUER` for issued assets, `pool:<id>` for
 * liquidity-pool shares) and is what the `asset` filter matches against.
 */
export interface AssetRef {
  id: string;
  type: "native" | "credit_alphanum4" | "credit_alphanum12" | "liquidity_pool_shares";
  code: string;
  issuer: string | null;
}

/** High-level category the activity list renders; see docs/transaction-history.md. */
export type HistoryItemType =
  | "payment"
  | "swap"
  | "trustline"
  | "account_created"
  | "contract"
  | "other";

/** Direction relative to the account whose history is being viewed. */
export type HistoryDirection = "in" | "out" | "self";

/**
 * One operation from an account's history, mapped so a UI can render
 * "Received 25 USDC from G…ABC" without further Horizon calls. All amounts
 * are decimal strings (7 dp, as Horizon returns them) — never numbers.
 */
export interface HistoryItem {
  /** Horizon operation id. */
  id: string;
  /** Opaque cursor; pass as `cursor` to continue after this item. */
  pagingToken: string;
  type: HistoryItemType;
  /** Raw Horizon operation type (e.g. `path_payment_strict_send`). */
  operationType: string;
  direction: HistoryDirection;
  /** Amount moved/received from the viewing account's perspective, or null when the op carries none. */
  amount: string | null;
  asset: AssetRef | null;
  /** For swaps and path payments: what was spent. Null otherwise. */
  sourceAmount: string | null;
  sourceAsset: AssetRef | null;
  /** The other party (G… or C… address), or null when there is none. */
  counterparty: string | null;
  /** Trustline ops only: the new limit ("0.0000000" means the trustline was removed). */
  trustlineLimit: string | null;
  /** Contract ops only: the host function invoked (e.g. `HostFunctionTypeHostFunctionTypeInvokeContract`). */
  contractFunction: string | null;
  memo: string | null;
  memoType: string | null;
  /** Fee charged for the whole parent transaction, in XLM. Repeated on every op of a multi-op tx. */
  fee: string | null;
  /** Account that paid `fee`; only show the fee to the user when this equals their address. */
  feePayer: string | null;
  transactionHash: string;
  /** Number of operations in the parent transaction (> 1 for multi-op transactions). */
  transactionOperationCount: number | null;
  createdAt: string;
  successful: boolean;
}

export interface HistoryPage {
  items: HistoryItem[];
  /** Cursor for the next page; undefined when there is nothing left to fetch. */
  next: string | undefined;
  hasMore: boolean;
  /**
   * True when a filtered request stopped because it hit the scan cap before
   * finding `limit` matches. `next` then resumes scanning where it stopped.
   */
  scanCapped: boolean;
  /** Number of Horizon operations examined to build this page. */
  scanned: number;
}

/** GET /api/v1/transactions/:hash response (#60). */
export interface TransactionDetail {
  hash: string;
  ledger: number;
  createdAt: string;
  successful: boolean;
  sourceAccount: string;
  feeAccount: string;
  /** Fee actually charged, in XLM. */
  fee: string;
  /** Maximum fee the submitter was willing to pay, in XLM. */
  maxFee: string;
  memo: string | null;
  memoType: string;
  operationCount: number;
  /** Address operations' `direction` is relative to (the `account` query param, or the source account). */
  perspective: string;
  operations: HistoryItem[];
  /** stellar.expert link for the configured network, or null on networks it doesn't index. */
  explorerUrl: string | null;
}
