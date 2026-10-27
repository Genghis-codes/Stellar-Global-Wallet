import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export type DataKey = {tag: "Admin", values: void} | {tag: "PendingAdmin", values: readonly [string]} | {tag: "PendingUpgrade", values: void} | {tag: "UserAssets", values: readonly [string]} | {tag: "SpendLimit", values: readonly [string, string]} | {tag: "DailySpent", values: readonly [string, string]} | {tag: "Guardians", values: void} | {tag: "RecoveryConfig", values: void} | {tag: "RecoveryProposal", values: void} | {tag: "GuardianMembership", values: void} | {tag: "TokenWrapperId", values: void} | {tag: "AllowedToken", values: readonly [string]} | {tag: "AllowedTokens", values: void};


export interface AssetInfo {
  /**
 * e.g. "XLM", "USDC"
 * 
 * **Canonicalization decision (issue #29):** `code` must be non-empty
 * and at most [`GlobeWallet::MAX_ASSET_CODE_LEN`] bytes — enforced by
 * [`GlobeWallet::add_asset`]. Storage preserves the caller's original
 * casing, but duplicate detection in `add_asset` treats codes as equal
 * case-insensitively (ASCII), so `"USDC"` and `"usdc"` are considered
 * the same asset and cannot both be registered for one user.
 */
code: string;
  /**
 * Issuer address; None for XLM (native)
 */
issuer: Option<string>;
}


export interface SpendRecord {
  amount: i128;
  /**
 * Ledger-time timestamp of the current day window
 */
day: u64;
}

export const WalletError = {
  1001: {message:"AlreadyInitialized"},
  1002: {message:"NotInitialized"},
  1003: {message:"Unauthorized"},
  1004: {message:"AssetAlreadyAdded"},
  1005: {message:"AssetNotFound"},
  1006: {message:"InvalidSpendLimit"},
  /**
   * Payment would exceed the daily spend limit for this asset
   */
  1007: {message:"SpendLimitExceeded"},
  1008: {message:"NoAssetsProvided"},
  1009: {message:"NoPendingAdmin"},
  1010: {message:"SpendOverflow"},
  1011: {message:"AssetLimitExceeded"},
  1012: {message:"MaxAssetsReached"},
  1013: {message:"UpgradeAlreadyPending"},
  1014: {message:"UpgradeNotPending"},
  1015: {message:"UpgradeHashMismatch"},
  1016: {message:"UpgradeNotReady"},
  1017: {message:"UpgradeFailed"},
  /**
   * Guardian address already registered.
   */
  1018: {message:"GuardianAlreadyAdded"},
  /**
   * Address is not a registered guardian.
   */
  1019: {message:"GuardianNotFound"},
  /**
   * Recovery threshold must be `1 < threshold <= guardians.len()`.
   */
  1020: {message:"InvalidRecoveryThreshold"},
  /**
   * `add_guardian`/`set_recovery_config` would leave threshold >
   * guardian count, or guardians.len() below the required minimum.
   */
  1021: {message:"NotEnoughGuardians"},
  /**
   * No recovery threshold/delay configured yet — call `set_recovery_config` first.
   */
  1022: {message:"RecoveryNotConfigured"},
  /**
   * A recovery proposal is already in flight; cancel or execute it first.
   */
  1023: {message:"RecoveryAlreadyPending"},
  /**
   * No recovery proposal is currently pending.
   */
  1024: {message:"NoPendingRecovery"},
  /**
   * Guardian has already approved the pending proposal.
   */
  1025: {message:"AlreadyApproved"},
  /**
   * Guardian has not approved the pending proposal (nothing to revoke).
   */
  1026: {message:"ApprovalNotFound"},
  /**
   * Quorum reached but the timelock delay has not yet elapsed.
   */
  1027: {message:"RecoveryNotReady"},
  /**
   * Approvals dropped below threshold since quorum was reached; timelock reset.
   */
  1028: {message:"RecoveryNotQuorate"},
  /**
   * Asset code and issuer configuration is invalid
   */
  1029: {message:"InvalidAssetInfo"},
  /**
   * Proposed wasm hash is not registered on-chain (never uploaded via upload_contract_wasm)
   */
  1030: {message:"UpgradeWasmNotUploaded"},
  /**
   * `add_guardian` would exceed [`GlobeWallet::MAX_GUARDIANS`].
   */
  1031: {message:"GuardianLimitExceeded"},
  /**
   * `execute_recovery`'s proposal targets the same address that is
   * already the current admin — recovering "to" a no-op target is
   * rejected rather than silently succeeding as a wasted transfer.
   */
  1032: {message:"RecoveryNewAdminUnchanged"},
  /**
   * `AssetInfo.code` is empty or exceeds `GlobeWallet::MAX_ASSET_CODE_LEN`.
   */
  1033: {message:"InvalidAssetCode"},
  /**
   * `send`'s `token_id` is not on the admin-curated allowlist. See
   * docs/design/wiring-reentrancy-threat-model.md §4.
   */
  1034: {message:"TokenNotAllowed"},
  /**
   * `send` was called before an admin configured the token-wrapper
   * contract instance via `set_token_wrapper`.
   */
  1035: {message:"TokenWrapperNotSet"},
  /**
   * The `token-wrapper::transfer_from` call `send` makes failed (e.g.
   * insufficient/expired allowance) or could not be invoked at all.
   */
  1036: {message:"TokenTransferFailed"},
  /**
   * `propose_upgrade`'s `delay_in_ledgers` is below
   * [`GlobeWallet::MIN_UPGRADE_DELAY_LEDGERS`] (see issue #84).
   */
  1037: {message:"UpgradeDelayTooShort"},
  /**
   * `set_recovery_config`'s `delay_in_ledgers` is below
   * [`GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS`] (see issue #84).
   */
  1038: {message:"RecoveryDelayTooShort"}
}


export interface RecoveryConfig {
  /**
 * Ledger-count delay between reaching quorum and `execute_recovery`
 * becoming callable. Gives the legitimate admin a window to notice
 * and cancel a malicious or mistaken recovery.
 */
delay_in_ledgers: u32;
  /**
 * Number of distinct guardian approvals required to reach quorum.
 */
threshold: u32;
}


/**
 * Read-only view of a user's daily spend window for one asset, returned by
 * [`GlobeWallet::get_spend_allowance`] (issue #50).
 * 
 * The window is the same 86 400-second bucket `record_spend` uses:
 * `day = ledger_timestamp / 86400`. Ledger timestamps are Unix seconds, so
 * windows start and end exactly at 00:00:00 UTC *as measured by ledger
 * close time*, not wall-clock time on any client or server.
 */
export interface SpendAllowance {
  /**
 * Configured daily cap (0 = unlimited).
 */
limit: i128;
  /**
 * `limit - spent`, floored at 0. 0 when `limit == 0` — callers must
 * check `limit` to distinguish "unlimited" from "nothing left".
 */
remaining: i128;
  /**
 * Amount recorded in the current window. Always 0 when `limit == 0`,
 * because `record_spend` does not track spends for unlimited assets.
 */
spent: i128;
  /**
 * Ledger timestamp (Unix seconds) at which the next window begins and
 * `spent` resets to 0.
 */
window_resets_at: u64;
  /**
 * Ledger timestamp (Unix seconds) at which the current window began.
 */
window_start: u64;
}


export interface UpgradeProposal {
  proposed_by: string;
  ready_at: u32;
  wasm_hash: Buffer;
}


export interface RecoveryProposal {
  approvals: Array<string>;
  new_admin: string;
  /**
 * Set once quorum is first reached; cleared again if approvals drop
 * back below threshold. `execute_recovery` requires `ledger seq >= ready_at`.
 */
ready_at: Option<u32>;
}


/**
 * Payload of the `recovery_completed` event `execute_recovery` publishes
 * (see issue #91). Every other event in this contract is a raw tuple —
 * this one is deliberately a named `#[contracttype]` struct instead, and
 * that's a one-off departure worth explaining rather than a stylistic
 * accident: a tuple's fields are positional and undocumented in the
 * on-chain XDR itself, which is a tolerable ergonomics trade-off for a
 * 2-3 field payload where order is obvious from context. This event has
 * five fields feeding a security-alerting integration, where a
 * transposed pair of `Address`es (e.g. an indexer reading `new_admin`
 * where `old_admin` belongs) has real consequences — it would misreport
 * *who just lost control of a wallet* during exactly the incident that
 * most needs to be reported correctly. A named struct makes every field
 * self-describing in the XDR, independent of any off-chain schema the
 * reader has to already know and keep in sync by hand. The cost is
 * inconsistency with this contract's existing tuple-event conventio
 */
export interface RecoveryCompletedEvent {
  /**
 * Every guardian whose approval is on the executed proposal — not
 * just the `threshold` minimum. A recovery ratified 5-of-5 and one
 * ratified 3-of-5 (with `threshold == 3`) are different-risk events
 * even though both satisfy the same on-chain quorum check; an
 * alerting integration that only knows "quorum was reached" can't
 * tell them apart, this field lets it.
 */
approving_guardians: Array<string>;
  /**
 * Ledger sequence of the `execute_recovery` call itself. Comparing
 * this against `ready_at` tells an observer how promptly the
 * now-executable recovery was actually claimed — a long gap can be
 * as meaningful to a monitoring system as the recovery itself (e.g.
 * "why did nobody execute an approved recovery for three days?").
 */
executed_at: u32;
  /**
 * Admin address the guardians recovered control to.
 */
new_admin: string;
  /**
 * Admin address in control immediately before this recovery.
 */
old_admin: string;
  /**
 * Ledger sequence at which the timelock elapsed and this recovery
 * became executable (`RecoveryProposal.ready_at` at execution time).
 */
ready_at: u32;
  /**
 * `RecoveryConfig.threshold` in effect for this execution — the
 * minimum quorum size, for computing how much above/below the bare
 * minimum `approving_guardians` actually was.
 */
threshold: u32;
}


export interface Allowance {
  amount: i128;
  expiry_ledger: u32;
}

export const WrapperError = {
  2001: {message:"AllowanceExpired"},
  2002: {message:"InsufficientAllowance"},
  2003: {message:"InvalidAmount"},
  2004: {message:"InvalidExpiry"}
}

export type WrapperDataKey = {tag: "Allowance", values: readonly [string, string]};

export interface Client {
  /**
   * Construct and simulate a send transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Atomically enforce the daily spend limit and move `amount` of
   * `token_id` from `user` to `to`, via `token-wrapper::transfer_from`.
   * 
   * `user` must have already granted this contract (i.e.
   * `env.current_contract_address()`) an allowance over `token_id` via
   * `token-wrapper::approve` before calling this — matching
   * `docs/design/architecture.md`'s intended integration flow.
   * 
   * # Errors
   * * [`WalletError::TokenNotAllowed`] if `token_id` is not allowlisted.
   * * [`WalletError::TokenWrapperNotSet`] if no admin has configured the
   * token-wrapper instance yet.
   * * [`WalletError::SpendLimitExceeded`] / [`WalletError::SpendOverflow`]
   * per `record_spend`'s existing rules.
   * 
   * A failure at any step reverts the whole call, including any
   * `record_spend` write already applied in this same invocation —
   * Soroban transactions are all-or-nothing, so there is no path where
   * the daily counter advances without the underlying transfer actually
   * succeeding (or vice versa).
   */
  send: ({user, token_id, asset_code, to, amount}: {user: string, token_id: string, asset_code: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return current admin.
   */
  admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a add_asset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Add an asset to a user's wallet registry.
   * 
   * Only the user themselves (via `require_auth`) can add assets.
   * 
   * # Errors
   * * [`WalletError::InvalidAssetCode`] — `asset.code` is empty or exceeds
   * [`Self::MAX_ASSET_CODE_LEN`].
   * * [`WalletError::AssetAlreadyAdded`] — asset code already registered
   * (case-insensitive — see [`AssetInfo::code`]'s doc comment).
   * * [`WalletError::AssetLimitExceeded`] — user would exceed [`Self::MAX_ASSETS`].
   */
  add_asset: ({user, asset}: {user: string, asset: AssetInfo}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a guardians transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the current guardian set.
   */
  guardians: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a get_assets transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return all assets registered by a user.
   */
  get_assets: ({user}: {user: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<AssetInfo>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Initialize the contract with an admin address.
   * 
   * # Errors
   * * [`WalletError::AlreadyInitialized`]
   */
  initialize: ({admin}: {admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a accept_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Accept a pending admin proposal.
   */
  accept_admin: ({candidate}: {candidate: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a add_guardian transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Register a new guardian. Admin-authorized.
   * 
   * # Errors
   * * [`WalletError::GuardianAlreadyAdded`]
   * * [`WalletError::GuardianLimitExceeded`] — would exceed
   * [`Self::MAX_GUARDIANS`] (see issue #27).
   */
  add_guardian: ({admin, guardian}: {admin: string, guardian: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a record_spend transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Record a spend and reject if it would exceed the daily limit.
   * 
   * Call this from any payment-execution path to enforce limits.
   * Day window is a 86 400-second bucket derived from ledger timestamp.
   * 
   * Reentrancy invariant: keep the interval from reading `DailySpent`
   * through writing its replacement free of external contract calls. See
   * `docs/record-spend-reentrancy.md` for the proof and change guidance.
   * 
   * `amount` must be strictly positive. `require_auth()` on `user`
   * authenticates the *caller*, not the *value* — in the compromised-key
   * threat model this function exists to defend against, the attacker
   * can already produce valid `user` signatures, so `require_auth()`
   * alone provides no protection here. A non-positive `amount` would let
   * that same attacker call `record_spend` with a negative value to
   * decrease (or zero out) `spent_today` below what was actually spent,
   * then immediately follow it with a legitimate large spend the
   * configured limit was supposed to block — silently defeating the
   * limit. See issue #25 for the full
   */
  record_spend: ({user, asset_code, amount}: {user: string, asset_code: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a remove_asset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove an asset from a user's wallet registry.
   * 
   * # Errors
   * * [`WalletError::AssetNotFound`] — asset code not registered.
   */
  remove_asset: ({user, asset_code}: {user: string, asset_code: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a pending_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the pending admin candidate, if any.
   */
  pending_admin: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a propose_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Propose a new admin candidate.
   * 
   * The current admin remains in control until the candidate accepts.
   */
  propose_admin: ({current, candidate}: {current: string, candidate: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a allowed_tokens transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the list of all allowed token contract addresses (alias).
   */
  allowed_tokens: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a transfer_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Legacy single-step admin transfer.
   * 
   * Deprecated in favor of `propose_admin` + `accept_admin`.
   * 
   * # Errors
   * * [`WalletError::NotInitialized`] / [`WalletError::Unauthorized`]
   */
  transfer_admin: ({current, new_admin}: {current: string, new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_recovery transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The current admin cancels a pending recovery. This is the primary
   * abuse/griefing defense: as long as the legitimate admin key is still
   * usable, a colluding guardian majority can be stopped at any point
   * before `execute_recovery` succeeds — including after quorum, during
   * the timelock window.
   */
  cancel_recovery: ({admin}: {admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a execute_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Execute a previously proposed upgrade after the timelock elapses.
   * 
   * This function validates that:
   * 1. A proposal exists and is stored in instance storage
   * 2. The provided `wasm_hash` matches the proposed hash (via equality check)
   * 3. The current ledger sequence has reached or exceeded `ready_at` (timelock elapsed)
   * 4. The `wasm_hash` was previously registered on-chain via [`Env::deployer().upload_contract_wasm()`]
   * 
   * # Errors
   * * [`WalletError::UpgradeNotPending`] — no pending upgrade proposal
   * * [`WalletError::UpgradeHashMismatch`] — provided hash doesn't match stored proposal
   * * [`WalletError::UpgradeNotReady`] — timelock has not yet elapsed
   * * [`WalletError::UpgradeWasmNotUploaded`] — wasm hash was never registered on-chain
   * 
   * # Operational Notes
   * Correct upgrade sequence is:
   * 1. Upload new contract WASM via a separate transaction → obtain wasm_hash
   * 2. Call `propose_upgrade` with that hash and desired delay
   * 3. Wait for the delay (in ledgers) to elapse
   * 4. Call `execute_upgrade` with the same hash
   * 
   * If a WASM blob 
   */
  execute_upgrade: ({executor, wasm_hash}: {executor: string, wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_spend_limit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get the daily spend limit for a user/asset pair (0 = unlimited).
   */
  get_spend_limit: ({user, asset_code}: {user: string, asset_code: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a get_spent_today transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Amount spent by `user` in `asset_code` during the current day window
   * (issue #50). Mirrors `record_spend`'s window logic exactly: a stored
   * record from an earlier `day` bucket counts as 0.
   */
  get_spent_today: ({user, asset_code}: {user: string, asset_code: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a pending_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the pending upgrade proposal, if any.
   */
  pending_upgrade: (options?: MethodOptions) => Promise<AssembledTransaction<Option<UpgradeProposal>>>

  /**
   * Construct and simulate a propose_upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Queue an upgrade for later execution.
   * 
   * The proposal is stored in contract instance storage and emitted as an
   * event so the upgrade is visible on-chain before any code swap occurs.
   * 
   * The provided `wasm_hash` is stored as-is *without validation* — it is
   * the caller's responsibility to ensure it matches a blob previously uploaded
   * on-chain via [`Env::deployer().upload_contract_wasm()`]. No pre-check is
   * performed here; validation occurs when `execute_upgrade` is called.
   * 
   * # Errors
   * * [`WalletError::UpgradeAlreadyPending`] — an upgrade is already queued
   * * [`WalletError::Unauthorized`] — caller is not the current admin
   * * [`WalletError::UpgradeDelayTooShort`] — `delay_in_ledgers` is below
   * [`Self::MIN_UPGRADE_DELAY_LEDGERS`] (see issue #84)
   * 
   * See [`Self::execute_upgrade`] for operational notes and the correct
   * sequence of steps (upload → propose → wait → execute).
   */
  propose_upgrade: ({proposer, wasm_hash, delay_in_ledgers}: {proposer: string, wasm_hash: Buffer, delay_in_ledgers: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a recovery_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the current recovery configuration, if any.
   */
  recovery_config: (options?: MethodOptions) => Promise<AssembledTransaction<Option<RecoveryConfig>>>

  /**
   * Construct and simulate a remove_guardian transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove a guardian. Admin-authorized.
   * 
   * If a recovery proposal is currently pending and the removed guardian
   * had already approved it, that approval is stripped from the proposal
   * as part of this same call (design decision (a) from issue #26, chosen
   * over documenting the removal as approval-preserving): an admin who
   * removes a guardian because they no longer trust that guardian's key
   * must not have a since-revoked guardian's vote still able to push a
   * recovery to quorum and completion. If stripping the approval drops
   * the proposal back below `RecoveryConfig.threshold`, `ready_at` is
   * cleared exactly as `revoke_recovery_approval` already does on its own
   * below-threshold path, so the timelock has to be re-armed by a fresh
   * round of approvals rather than silently keeping a stale countdown
   * alive on a now-under-quorum proposal. This mutation cannot itself
   * fail: it can only ever remove an entry from a `Vec`/clear an
   * `Option`, neither of which has a fallible precondition.
   * 
   * # Errors
   * * [`WalletError::NotEnoughGuardians`] — woul
   */
  remove_guardian: ({admin, guardian}: {admin: string, guardian: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_spend_limit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set a daily spend limit (in stroops) for a specific asset.
   * 
   * `limit = 0` removes the limit (unlimited).
   * 
   * **Retroactive enforcement:** if the user has already spent more than
   * the proposed new limit in the current day window, the call is rejected
   * with `SpendLimitExceeded`. This prevents a limit-lowering from
   * silently granting headroom that was only valid under the old, higher
   * limit.
   * 
   * # Errors
   * * [`WalletError::InvalidSpendLimit`] — negative limit.
   * * [`WalletError::SpendLimitExceeded`] — current day's spend already
   * exceeds the proposed limit.
   */
  set_spend_limit: ({user, asset_code, limit}: {user: string, asset_code: string, limit: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a approve_recovery transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * A guardian approves the pending recovery proposal.
   * 
   * Once approvals reach the configured threshold, the timelock is
   * armed: `ready_at = current_ledger_sequence + delay_in_ledgers`.
   */
  approve_recovery: ({guardian}: {guardian: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a execute_recovery transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Execute a recovery once quorum has been reached and the timelock has
   * elapsed. Callable by anyone (typically a guardian or the new admin
   * candidate) — authorization comes entirely from the guardian
   * signatures already recorded on the proposal, not from the caller.
   * 
   * Deliberately does **not** call `require_admin`/`current.require_auth()`:
   * that is precisely the capability that is unavailable when a device is
   * lost. Re-checks quorum at execution time (not just at
   * `approve_recovery` time) in case a guardian revoked between quorum
   * and timelock expiry in a way this contract didn't observe (defense in
   * depth; `revoke_recovery_approval` already clears `ready_at`, but this
   * guards against any future code path that forgets to).
   * 
   * Any in-flight *normal* `propose_admin`/`accept_admin` transfer is
   * cancelled as part of executing a recovery, so the two flows can't race.
   * 
   * # Events (see issue #91)
   * Publishes **two** events, deliberately, not one:
   * 1. `admin_transferred` — identical topic and payload shape to what
   * `accept_admin` pub
   */
  execute_recovery: (options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a is_token_allowed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns whether `token_id` is currently allowlisted for `send`.
   */
  is_token_allowed: ({token_id}: {token_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a add_allowed_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin: add `token_id` to the set of tokens `send` is permitted to move.
   * 
   * This is a governance/curation decision, not something this contract
   * can verify on-chain — the admin is expected to have confirmed
   * `token_id` implements the standard token interface correctly and
   * represents a real, valued asset before allowlisting it. See
   * docs/design/wiring-reentrancy-threat-model.md §4-5.
   */
  add_allowed_token: ({admin, token_id}: {admin: string, token_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_token_wrapper transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the currently configured token-wrapper contract instance, if any.
   */
  get_token_wrapper: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a initiate_recovery transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * A guardian initiates a recovery to `new_admin`. Counts as that
   * guardian's own approval.
   * 
   * # Errors
   * * [`WalletError::RecoveryNotConfigured`]
   * * [`WalletError::Unauthorized`] — caller is not a registered guardian.
   * * [`WalletError::RecoveryAlreadyPending`]
   */
  initiate_recovery: ({guardian, new_admin}: {guardian: string, new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a recovery_proposal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the pending recovery proposal, if any.
   */
  recovery_proposal: (options?: MethodOptions) => Promise<AssembledTransaction<Option<RecoveryProposal>>>

  /**
   * Construct and simulate a set_token_wrapper transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin: set the token-wrapper contract instance `send` calls into.
   */
  set_token_wrapper: ({admin, token_wrapper_id}: {admin: string, token_wrapper_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_allowed_tokens transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the list of all allowed token contract addresses.
   */
  get_allowed_tokens: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a get_spend_allowance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Limit, spent and remaining amounts for the current day window, plus
   * the ledger timestamps bounding it (issue #50). Read-only; intended to
   * be simulated rather than submitted.
   */
  get_spend_allowance: ({user, asset_code}: {user: string, asset_code: string}, options?: MethodOptions) => Promise<AssembledTransaction<SpendAllowance>>

  /**
   * Construct and simulate a migrate_user_assets transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin and user: trim a user's asset list to [`GlobeWallet::MAX_ASSETS`] if it exceeds the bound.
   * Returns the number of assets trimmed (0 if already within limit).
   * 
   * # Authorization Decision
   * Dual authorization is required: `admin.require_auth()` ensures only an
   * administrator can initiate a migration, while `user.require_auth()`
   * preserves the self-sovereign property of the wallet by ensuring the
   * user consents to the exact asset list modification taking place.
   */
  migrate_user_assets: ({admin, user}: {admin: string, user: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a set_recovery_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Configure (or reconfigure) the M-of-N recovery threshold and the
   * post-quorum timelock delay. Admin-authorized.
   * 
   * ## Design decision: rejected while a recovery is pending (issue #28)
   * A `RecoveryProposal`'s `ready_at` is computed once, at the moment
   * quorum is reached in `approve_recovery`, and frozen into storage —
   * it does not retroactively track later `delay_in_ledgers` changes.
   * Meanwhile `execute_recovery`'s quorum check reads the *live*
   * `RecoveryConfig.threshold`, not the config in effect when quorum was
   * reached. That half-live, half-frozen coupling is confusing enough
   * (and undertested enough — see #28) that the safer design is to
   * disallow the ambiguity outright: while a `RecoveryProposal` exists,
   * `set_recovery_config` is rejected with [`WalletError::RecoveryAlreadyPending`].
   * An admin who wants to change the threshold/delay while a recovery is
   * in flight must first call `cancel_recovery` (if reachable) — the
   * already-existing, unambiguous way to stop a pending proposal — rather
   * than mutate config undern
   */
  set_recovery_config: ({admin, threshold, delay_in_ledgers}: {admin: string, threshold: u32, delay_in_ledgers: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a remove_allowed_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Admin: remove `token_id` from the send-allowlist.
   */
  remove_allowed_token: ({admin, token_id}: {admin: string, token_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_admin_transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Cancel the current pending admin proposal.
   */
  cancel_admin_transfer: ({current}: {current: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a revoke_recovery_approval transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * A guardian revokes their own approval of the pending recovery.
   * 
   * If approvals drop below threshold, the timelock is disarmed
   * (`ready_at` cleared) — quorum must be reached again from scratch,
   * restarting the delay window.
   * 
   * # Errors
   * * [`WalletError::Unauthorized`] — caller is not a currently
   * registered guardian. Added for consistency with
   * `initiate_recovery`/`approve_recovery`, which both already gate on
   * `require_guardian`; this function was the one exception to that
   * pattern (see issue #26) — harmless on its own since revoking only
   * ever *removes* an approval, but leaving it unchecked meant guardian
   * membership wasn't enforced consistently across the whole approval
   * lifecycle.
   */
  revoke_recovery_approval: ({guardian}: {guardian: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a approve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Grant a spender allowance over the caller's tokens.
   * 
   * **Overwrite semantics:** calling `approve` for an existing
   * `(owner, spender)` pair **replaces** the previous allowance
   * wholesale — it does **not** add to the remaining balance.
   * If a spender has already used part of their allowance and
   * the owner calls `approve` again, the new `amount` becomes the
   * *total* allowance, not an increment on top of what's left.
   * 
   * `expiry_ledger` must be in the future.
   */
  approve: ({owner, spender, amount, expiry_ledger}: {owner: string, spender: string, amount: i128, expiry_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a allowance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return current allowance for (owner, spender).
   */
  allowance: ({owner, spender}: {owner: string, spender: string}, options?: MethodOptions) => Promise<AssembledTransaction<Allowance>>

  /**
   * Construct and simulate a transfer_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transfer tokens from `from` to `to` using a previously granted allowance.
   * 
   * Decrements the allowance; fails if expired or insufficient.
   * An allowance is usable through and including its `expiry_ledger`.
   */
  transfer_from: ({spender, token_id, from, to, amount}: {spender: string, token_id: string, from: string, to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAA6xBdG9taWNhbGx5IGVuZm9yY2UgdGhlIGRhaWx5IHNwZW5kIGxpbWl0IGFuZCBtb3ZlIGBhbW91bnRgIG9mCmB0b2tlbl9pZGAgZnJvbSBgdXNlcmAgdG8gYHRvYCwgdmlhIGB0b2tlbi13cmFwcGVyOjp0cmFuc2Zlcl9mcm9tYC4KCmB1c2VyYCBtdXN0IGhhdmUgYWxyZWFkeSBncmFudGVkIHRoaXMgY29udHJhY3QgKGkuZS4KYGVudi5jdXJyZW50X2NvbnRyYWN0X2FkZHJlc3MoKWApIGFuIGFsbG93YW5jZSBvdmVyIGB0b2tlbl9pZGAgdmlhCmB0b2tlbi13cmFwcGVyOjphcHByb3ZlYCBiZWZvcmUgY2FsbGluZyB0aGlzIOKAlCBtYXRjaGluZwpgZG9jcy9kZXNpZ24vYXJjaGl0ZWN0dXJlLm1kYCdzIGludGVuZGVkIGludGVncmF0aW9uIGZsb3cuCgojIEVycm9ycwoqIFtgV2FsbGV0RXJyb3I6OlRva2VuTm90QWxsb3dlZGBdIGlmIGB0b2tlbl9pZGAgaXMgbm90IGFsbG93bGlzdGVkLgoqIFtgV2FsbGV0RXJyb3I6OlRva2VuV3JhcHBlck5vdFNldGBdIGlmIG5vIGFkbWluIGhhcyBjb25maWd1cmVkIHRoZQp0b2tlbi13cmFwcGVyIGluc3RhbmNlIHlldC4KKiBbYFdhbGxldEVycm9yOjpTcGVuZExpbWl0RXhjZWVkZWRgXSAvIFtgV2FsbGV0RXJyb3I6OlNwZW5kT3ZlcmZsb3dgXQpwZXIgYHJlY29yZF9zcGVuZGAncyBleGlzdGluZyBydWxlcy4KCkEgZmFpbHVyZSBhdCBhbnkgc3RlcCByZXZlcnRzIHRoZSB3aG9sZSBjYWxsLCBpbmNsdWRpbmcgYW55CmByZWNvcmRfc3BlbmRgIHdyaXRlIGFscmVhZHkgYXBwbGllZCBpbiB0aGlzIHNhbWUgaW52b2NhdGlvbiDigJQKU29yb2JhbiB0cmFuc2FjdGlvbnMgYXJlIGFsbC1vci1ub3RoaW5nLCBzbyB0aGVyZSBpcyBubyBwYXRoIHdoZXJlCnRoZSBkYWlseSBjb3VudGVyIGFkdmFuY2VzIHdpdGhvdXQgdGhlIHVuZGVybHlpbmcgdHJhbnNmZXIgYWN0dWFsbHkKc3VjY2VlZGluZyAob3IgdmljZSB2ZXJzYSkuAAAABHNlbmQAAAAFAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAAIdG9rZW5faWQAAAATAAAAAAAAAAphc3NldF9jb2RlAAAAAAAQAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAALV2FsbGV0RXJyb3IA",
        "AAAAAAAAABVSZXR1cm4gY3VycmVudCBhZG1pbi4AAAAAAAAFYWRtaW4AAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAbBBZGQgYW4gYXNzZXQgdG8gYSB1c2VyJ3Mgd2FsbGV0IHJlZ2lzdHJ5LgoKT25seSB0aGUgdXNlciB0aGVtc2VsdmVzICh2aWEgYHJlcXVpcmVfYXV0aGApIGNhbiBhZGQgYXNzZXRzLgoKIyBFcnJvcnMKKiBbYFdhbGxldEVycm9yOjpJbnZhbGlkQXNzZXRDb2RlYF0g4oCUIGBhc3NldC5jb2RlYCBpcyBlbXB0eSBvciBleGNlZWRzCltgU2VsZjo6TUFYX0FTU0VUX0NPREVfTEVOYF0uCiogW2BXYWxsZXRFcnJvcjo6QXNzZXRBbHJlYWR5QWRkZWRgXSDigJQgYXNzZXQgY29kZSBhbHJlYWR5IHJlZ2lzdGVyZWQKKGNhc2UtaW5zZW5zaXRpdmUg4oCUIHNlZSBbYEFzc2V0SW5mbzo6Y29kZWBdJ3MgZG9jIGNvbW1lbnQpLgoqIFtgV2FsbGV0RXJyb3I6OkFzc2V0TGltaXRFeGNlZWRlZGBdIOKAlCB1c2VyIHdvdWxkIGV4Y2VlZCBbYFNlbGY6Ok1BWF9BU1NFVFNgXS4AAAAJYWRkX2Fzc2V0AAAAAAAAAgAAAAAAAAAEdXNlcgAAABMAAAAAAAAABWFzc2V0AAAAAAAH0AAAAAlBc3NldEluZm8AAAAAAAABAAAD6QAAA+0AAAAAAAAH0AAAAAtXYWxsZXRFcnJvcgA=",
        "AAAAAAAAACBSZXR1cm4gdGhlIGN1cnJlbnQgZ3VhcmRpYW4gc2V0LgAAAAlndWFyZGlhbnMAAAAAAAAAAAAAAQAAA+oAAAAT",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAADQAAAAAAAAAAAAAABUFkbWluAAAAAAAAAQAAACxQZW5kaW5nIGFkbWluIGNhbmRpZGF0ZSBhd2FpdGluZyBhY2NlcHRhbmNlLgAAAAxQZW5kaW5nQWRtaW4AAAABAAAAEwAAAAAAAAAAAAAADlBlbmRpbmdVcGdyYWRlAAAAAAABAAAAJFdoaXRlbGlzdGVkIGFzc2V0cyBmb3IgYSB1c2VyIHdhbGxldAAAAApVc2VyQXNzZXRzAAAAAAABAAAAEwAAAAEAAAA0U3BlbmQgbGltaXQ6ICh1c2VyLCBhc3NldF9jb2RlKSDihpIgbGltaXQgaW4gc3Ryb29wcwAAAApTcGVuZExpbWl0AAAAAAACAAAAEwAAABAAAAABAAAAO0RhaWx5IHNwZW50OiAodXNlciwgYXNzZXRfY29kZSkg4oaSIChhbW91bnQsIGRheV90aW1lc3RhbXApAAAAAApEYWlseVNwZW50AAAAAAACAAAAEwAAABAAAAAAAAAAR09yZGVyZWQgc2V0IG9mIGd1YXJkaWFuIGFkZHJlc3NlcyBhdXRob3JpemVkIHRvIGNvLXNpZ24gYWRtaW4gcmVjb3ZlcnkuAAAAAAlHdWFyZGlhbnMAAAAAAAAAAAAAf00tb2YtTiBhcHByb3ZhbHMgcmVxdWlyZWQsIGFuZCB0aGUgbGVkZ2VyLWNvdW50IHRpbWVsb2NrIGRlbGF5CmJldHdlZW4gcXVvcnVtIGJlaW5nIHJlYWNoZWQgYW5kIGEgcmVjb3ZlcnkgYmVjb21pbmcgZXhlY3V0YWJsZS4AAAAADlJlY292ZXJ5Q29uZmlnAAAAAAAAAAAAL1RoZSBzaW5nbGUgaW4tZmxpZ2h0IHJlY292ZXJ5IHByb3Bvc2FsLCBpZiBhbnkuAAAAABBSZWNvdmVyeVByb3Bvc2FsAAAAAAAAAMBNZW1iZXJzaGlwIGluZGV4IGZvciBndWFyZGlhbnMsIHVzZWQgdG8gYXZvaWQgc2NhbnMgb24gcmVjb3ZlcnkgY2FsbHMuCgpUaGlzIGlzIGludGVudGlvbmFsbHkgYXBwZW5kZWQgc28gdGhlIHNlcmlhbGl6ZWQgdmFsdWVzIG9mIGV4aXN0aW5nCnN0b3JhZ2Uga2V5cyByZW1haW4gc3RhYmxlIGFjcm9zcyBjb250cmFjdCB1cGdyYWRlcy4AAAASR3VhcmRpYW5NZW1iZXJzaGlwAAAAAAAAAAAAjFRoZSB0b2tlbi13cmFwcGVyIGNvbnRyYWN0IGluc3RhbmNlIGBzZW5kYCBjYWxscyBpbnRvLiBBZG1pbi1zZXQgdmlhCmBzZXRfdG9rZW5fd3JhcHBlcmAuIFNlZSBkb2NzL2Rlc2lnbi93aXJpbmctcmVlbnRyYW5jeS10aHJlYXQtbW9kZWwubWQuAAAADlRva2VuV3JhcHBlcklkAAAAAAABAAAAxkFkbWluLWN1cmF0ZWQgc2V0IG9mIHRva2VuIGNvbnRyYWN0IGFkZHJlc3NlcyBgc2VuZGAgaXMgcGVybWl0dGVkIHRvCm1vdmUuIE1lbWJlcnNoaXAgb25seSDigJQgcHJlc2VuY2Ugb2YgdGhlIGtleSBtZWFucyAiYWxsb3dlZCI7IHNlZQpgYWRkX2FsbG93ZWRfdG9rZW5gL2ByZW1vdmVfYWxsb3dlZF90b2tlbmAvYGlzX3Rva2VuX2FsbG93ZWRgLgAAAAAADEFsbG93ZWRUb2tlbgAAAAEAAAATAAAAAAAAADtBZG1pbi1jdXJhdGVkIGxpc3Qgb2YgYWxsIGFsbG93ZWQgdG9rZW4gY29udHJhY3QgYWRkcmVzc2VzLgAAAAANQWxsb3dlZFRva2VucwAAAA==",
        "AAAAAAAAACdSZXR1cm4gYWxsIGFzc2V0cyByZWdpc3RlcmVkIGJ5IGEgdXNlci4AAAAACmdldF9hc3NldHMAAAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAA+oAAAfQAAAACUFzc2V0SW5mbwAAAA==",
        "AAAAAAAAAF5Jbml0aWFsaXplIHRoZSBjb250cmFjdCB3aXRoIGFuIGFkbWluIGFkZHJlc3MuCgojIEVycm9ycwoqIFtgV2FsbGV0RXJyb3I6OkFscmVhZHlJbml0aWFsaXplZGBdAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAALV2FsbGV0RXJyb3IA",
        "AAAAAQAAAAAAAAAAAAAACUFzc2V0SW5mbwAAAAAAAAIAAAGlZS5nLiAiWExNIiwgIlVTREMiCgoqKkNhbm9uaWNhbGl6YXRpb24gZGVjaXNpb24gKGlzc3VlICMyOSk6KiogYGNvZGVgIG11c3QgYmUgbm9uLWVtcHR5CmFuZCBhdCBtb3N0IFtgR2xvYmVXYWxsZXQ6Ok1BWF9BU1NFVF9DT0RFX0xFTmBdIGJ5dGVzIOKAlCBlbmZvcmNlZCBieQpbYEdsb2JlV2FsbGV0OjphZGRfYXNzZXRgXS4gU3RvcmFnZSBwcmVzZXJ2ZXMgdGhlIGNhbGxlcidzIG9yaWdpbmFsCmNhc2luZywgYnV0IGR1cGxpY2F0ZSBkZXRlY3Rpb24gaW4gYGFkZF9hc3NldGAgdHJlYXRzIGNvZGVzIGFzIGVxdWFsCmNhc2UtaW5zZW5zaXRpdmVseSAoQVNDSUkpLCBzbyBgIlVTREMiYCBhbmQgYCJ1c2RjImAgYXJlIGNvbnNpZGVyZWQKdGhlIHNhbWUgYXNzZXQgYW5kIGNhbm5vdCBib3RoIGJlIHJlZ2lzdGVyZWQgZm9yIG9uZSB1c2VyLgAAAAAAAARjb2RlAAAAEAAAACVJc3N1ZXIgYWRkcmVzczsgTm9uZSBmb3IgWExNIChuYXRpdmUpAAAAAAAABmlzc3VlcgAAAAAD6AAAABM=",
        "AAAAAAAAACBBY2NlcHQgYSBwZW5kaW5nIGFkbWluIHByb3Bvc2FsLgAAAAxhY2NlcHRfYWRtaW4AAAABAAAAAAAAAAljYW5kaWRhdGUAAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAALV2FsbGV0RXJyb3IA",
        "AAAAAAAAAL9SZWdpc3RlciBhIG5ldyBndWFyZGlhbi4gQWRtaW4tYXV0aG9yaXplZC4KCiMgRXJyb3JzCiogW2BXYWxsZXRFcnJvcjo6R3VhcmRpYW5BbHJlYWR5QWRkZWRgXQoqIFtgV2FsbGV0RXJyb3I6Okd1YXJkaWFuTGltaXRFeGNlZWRlZGBdIOKAlCB3b3VsZCBleGNlZWQKW2BTZWxmOjpNQVhfR1VBUkRJQU5TYF0gKHNlZSBpc3N1ZSAjMjcpLgAAAAAMYWRkX2d1YXJkaWFuAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAhndWFyZGlhbgAAABMAAAABAAAD6QAAA+0AAAAAAAAH0AAAAAtXYWxsZXRFcnJvcgA=",
        "AAAAAAAABABSZWNvcmQgYSBzcGVuZCBhbmQgcmVqZWN0IGlmIGl0IHdvdWxkIGV4Y2VlZCB0aGUgZGFpbHkgbGltaXQuCgpDYWxsIHRoaXMgZnJvbSBhbnkgcGF5bWVudC1leGVjdXRpb24gcGF0aCB0byBlbmZvcmNlIGxpbWl0cy4KRGF5IHdpbmRvdyBpcyBhIDg2IDQwMC1zZWNvbmQgYnVja2V0IGRlcml2ZWQgZnJvbSBsZWRnZXIgdGltZXN0YW1wLgoKUmVlbnRyYW5jeSBpbnZhcmlhbnQ6IGtlZXAgdGhlIGludGVydmFsIGZyb20gcmVhZGluZyBgRGFpbHlTcGVudGAKdGhyb3VnaCB3cml0aW5nIGl0cyByZXBsYWNlbWVudCBmcmVlIG9mIGV4dGVybmFsIGNvbnRyYWN0IGNhbGxzLiBTZWUKYGRvY3MvcmVjb3JkLXNwZW5kLXJlZW50cmFuY3kubWRgIGZvciB0aGUgcHJvb2YgYW5kIGNoYW5nZSBndWlkYW5jZS4KCmBhbW91bnRgIG11c3QgYmUgc3RyaWN0bHkgcG9zaXRpdmUuIGByZXF1aXJlX2F1dGgoKWAgb24gYHVzZXJgCmF1dGhlbnRpY2F0ZXMgdGhlICpjYWxsZXIqLCBub3QgdGhlICp2YWx1ZSog4oCUIGluIHRoZSBjb21wcm9taXNlZC1rZXkKdGhyZWF0IG1vZGVsIHRoaXMgZnVuY3Rpb24gZXhpc3RzIHRvIGRlZmVuZCBhZ2FpbnN0LCB0aGUgYXR0YWNrZXIKY2FuIGFscmVhZHkgcHJvZHVjZSB2YWxpZCBgdXNlcmAgc2lnbmF0dXJlcywgc28gYHJlcXVpcmVfYXV0aCgpYAphbG9uZSBwcm92aWRlcyBubyBwcm90ZWN0aW9uIGhlcmUuIEEgbm9uLXBvc2l0aXZlIGBhbW91bnRgIHdvdWxkIGxldAp0aGF0IHNhbWUgYXR0YWNrZXIgY2FsbCBgcmVjb3JkX3NwZW5kYCB3aXRoIGEgbmVnYXRpdmUgdmFsdWUgdG8KZGVjcmVhc2UgKG9yIHplcm8gb3V0KSBgc3BlbnRfdG9kYXlgIGJlbG93IHdoYXQgd2FzIGFjdHVhbGx5IHNwZW50LAp0aGVuIGltbWVkaWF0ZWx5IGZvbGxvdyBpdCB3aXRoIGEgbGVnaXRpbWF0ZSBsYXJnZSBzcGVuZCB0aGUKY29uZmlndXJlZCBsaW1pdCB3YXMgc3VwcG9zZWQgdG8gYmxvY2sg4oCUIHNpbGVudGx5IGRlZmVhdGluZyB0aGUKbGltaXQuIFNlZSBpc3N1ZSAjMjUgZm9yIHRoZSBmdWxsAAAADHJlY29yZF9zcGVuZAAAAAMAAAAAAAAABHVzZXIAAAATAAAAAAAAAAphc3NldF9jb2RlAAAAAAAQAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAA+0AAAAAAAAH0AAAAAtXYWxsZXRFcnJvcgA=",
        "AAAAAAAAAHhSZW1vdmUgYW4gYXNzZXQgZnJvbSBhIHVzZXIncyB3YWxsZXQgcmVnaXN0cnkuCgojIEVycm9ycwoqIFtgV2FsbGV0RXJyb3I6OkFzc2V0Tm90Rm91bmRgXSDigJQgYXNzZXQgY29kZSBub3QgcmVnaXN0ZXJlZC4AAAAMcmVtb3ZlX2Fzc2V0AAAAAgAAAAAAAAAEdXNlcgAAABMAAAAAAAAACmFzc2V0X2NvZGUAAAAAABAAAAABAAAD6QAAA+0AAAAAAAAH0AAAAAtXYWxsZXRFcnJvcgA=",
        "AAAAAAAAACtSZXR1cm4gdGhlIHBlbmRpbmcgYWRtaW4gY2FuZGlkYXRlLCBpZiBhbnkuAAAAAA1wZW5kaW5nX2FkbWluAAAAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAGFQcm9wb3NlIGEgbmV3IGFkbWluIGNhbmRpZGF0ZS4KClRoZSBjdXJyZW50IGFkbWluIHJlbWFpbnMgaW4gY29udHJvbCB1bnRpbCB0aGUgY2FuZGlkYXRlIGFjY2VwdHMuAAAAAAAADXByb3Bvc2VfYWRtaW4AAAAAAAACAAAAAAAAAAdjdXJyZW50AAAAABMAAAAAAAAACWNhbmRpZGF0ZQAAAAAAABMAAAABAAAD6QAAA+0AAAAAAAAH0AAAAAtXYWxsZXRFcnJvcgA=",
        "AAAAAQAAAAAAAAAAAAAAC1NwZW5kUmVjb3JkAAAAAAIAAAAAAAAABmFtb3VudAAAAAAACwAAAC9MZWRnZXItdGltZSB0aW1lc3RhbXAgb2YgdGhlIGN1cnJlbnQgZGF5IHdpbmRvdwAAAAADZGF5AAAAAAY=",
        "AAAABAAAAAAAAAAAAAAAC1dhbGxldEVycm9yAAAAACYAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAD6QAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAA+oAAAAAAAAADFVuYXV0aG9yaXplZAAAA+sAAAAAAAAAEUFzc2V0QWxyZWFkeUFkZGVkAAAAAAAD7AAAAAAAAAANQXNzZXROb3RGb3VuZAAAAAAAA+0AAAAAAAAAEUludmFsaWRTcGVuZExpbWl0AAAAAAAD7gAAADlQYXltZW50IHdvdWxkIGV4Y2VlZCB0aGUgZGFpbHkgc3BlbmQgbGltaXQgZm9yIHRoaXMgYXNzZXQAAAAAAAASU3BlbmRMaW1pdEV4Y2VlZGVkAAAAAAPvAAAAAAAAABBOb0Fzc2V0c1Byb3ZpZGVkAAAD8AAAAAAAAAAOTm9QZW5kaW5nQWRtaW4AAAAAA/EAAAAAAAAADVNwZW5kT3ZlcmZsb3cAAAAAAAPyAAAAAAAAABJBc3NldExpbWl0RXhjZWVkZWQAAAAAA/MAAAAAAAAAEE1heEFzc2V0c1JlYWNoZWQAAAP0AAAAAAAAABVVcGdyYWRlQWxyZWFkeVBlbmRpbmcAAAAAAAP1AAAAAAAAABFVcGdyYWRlTm90UGVuZGluZwAAAAAAA/YAAAAAAAAAE1VwZ3JhZGVIYXNoTWlzbWF0Y2gAAAAD9wAAAAAAAAAPVXBncmFkZU5vdFJlYWR5AAAAA/gAAAAAAAAADVVwZ3JhZGVGYWlsZWQAAAAAAAP5AAAAJEd1YXJkaWFuIGFkZHJlc3MgYWxyZWFkeSByZWdpc3RlcmVkLgAAABRHdWFyZGlhbkFscmVhZHlBZGRlZAAAA/oAAAAlQWRkcmVzcyBpcyBub3QgYSByZWdpc3RlcmVkIGd1YXJkaWFuLgAAAAAAABBHdWFyZGlhbk5vdEZvdW5kAAAD+wAAAD5SZWNvdmVyeSB0aHJlc2hvbGQgbXVzdCBiZSBgMSA8IHRocmVzaG9sZCA8PSBndWFyZGlhbnMubGVuKClgLgAAAAAAGEludmFsaWRSZWNvdmVyeVRocmVzaG9sZAAAA/wAAAB7YGFkZF9ndWFyZGlhbmAvYHNldF9yZWNvdmVyeV9jb25maWdgIHdvdWxkIGxlYXZlIHRocmVzaG9sZCA+Cmd1YXJkaWFuIGNvdW50LCBvciBndWFyZGlhbnMubGVuKCkgYmVsb3cgdGhlIHJlcXVpcmVkIG1pbmltdW0uAAAAABJOb3RFbm91Z2hHdWFyZGlhbnMAAAAAA/0AAABQTm8gcmVjb3ZlcnkgdGhyZXNob2xkL2RlbGF5IGNvbmZpZ3VyZWQgeWV0IOKAlCBjYWxsIGBzZXRfcmVjb3ZlcnlfY29uZmlnYCBmaXJzdC4AAAAVUmVjb3ZlcnlOb3RDb25maWd1cmVkAAAAAAAD/gAAAEVBIHJlY292ZXJ5IHByb3Bvc2FsIGlzIGFscmVhZHkgaW4gZmxpZ2h0OyBjYW5jZWwgb3IgZXhlY3V0ZSBpdCBmaXJzdC4AAAAAAAAWUmVjb3ZlcnlBbHJlYWR5UGVuZGluZwAAAAAD/wAAACpObyByZWNvdmVyeSBwcm9wb3NhbCBpcyBjdXJyZW50bHkgcGVuZGluZy4AAAAAABFOb1BlbmRpbmdSZWNvdmVyeQAAAAAABAAAAAAzR3VhcmRpYW4gaGFzIGFscmVhZHkgYXBwcm92ZWQgdGhlIHBlbmRpbmcgcHJvcG9zYWwuAAAAAA9BbHJlYWR5QXBwcm92ZWQAAAAEAQAAAENHdWFyZGlhbiBoYXMgbm90IGFwcHJvdmVkIHRoZSBwZW5kaW5nIHByb3Bvc2FsIChub3RoaW5nIHRvIHJldm9rZSkuAAAAABBBcHByb3ZhbE5vdEZvdW5kAAAEAgAAADpRdW9ydW0gcmVhY2hlZCBidXQgdGhlIHRpbWVsb2NrIGRlbGF5IGhhcyBub3QgeWV0IGVsYXBzZWQuAAAAAAAQUmVjb3ZlcnlOb3RSZWFkeQAABAMAAABLQXBwcm92YWxzIGRyb3BwZWQgYmVsb3cgdGhyZXNob2xkIHNpbmNlIHF1b3J1bSB3YXMgcmVhY2hlZDsgdGltZWxvY2sgcmVzZXQuAAAAABJSZWNvdmVyeU5vdFF1b3JhdGUAAAAABAQAAAAuQXNzZXQgY29kZSBhbmQgaXNzdWVyIGNvbmZpZ3VyYXRpb24gaXMgaW52YWxpZAAAAAAAEEludmFsaWRBc3NldEluZm8AAAQFAAAAV1Byb3Bvc2VkIHdhc20gaGFzaCBpcyBub3QgcmVnaXN0ZXJlZCBvbi1jaGFpbiAobmV2ZXIgdXBsb2FkZWQgdmlhIHVwbG9hZF9jb250cmFjdF93YXNtKQAAAAAWVXBncmFkZVdhc21Ob3RVcGxvYWRlZAAAAAAEBgAAADtgYWRkX2d1YXJkaWFuYCB3b3VsZCBleGNlZWQgW2BHbG9iZVdhbGxldDo6TUFYX0dVQVJESUFOU2BdLgAAAAAVR3VhcmRpYW5MaW1pdEV4Y2VlZGVkAAAAAAAEBwAAAL1gZXhlY3V0ZV9yZWNvdmVyeWAncyBwcm9wb3NhbCB0YXJnZXRzIHRoZSBzYW1lIGFkZHJlc3MgdGhhdCBpcwphbHJlYWR5IHRoZSBjdXJyZW50IGFkbWluIOKAlCByZWNvdmVyaW5nICJ0byIgYSBuby1vcCB0YXJnZXQgaXMKcmVqZWN0ZWQgcmF0aGVyIHRoYW4gc2lsZW50bHkgc3VjY2VlZGluZyBhcyBhIHdhc3RlZCB0cmFuc2Zlci4AAAAAAAAZUmVjb3ZlcnlOZXdBZG1pblVuY2hhbmdlZAAAAAAABAgAAABHYEFzc2V0SW5mby5jb2RlYCBpcyBlbXB0eSBvciBleGNlZWRzIGBHbG9iZVdhbGxldDo6TUFYX0FTU0VUX0NPREVfTEVOYC4AAAAAEEludmFsaWRBc3NldENvZGUAAAQJAAAAcWBzZW5kYCdzIGB0b2tlbl9pZGAgaXMgbm90IG9uIHRoZSBhZG1pbi1jdXJhdGVkIGFsbG93bGlzdC4gU2VlCmRvY3MvZGVzaWduL3dpcmluZy1yZWVudHJhbmN5LXRocmVhdC1tb2RlbC5tZCDCpzQuAAAAAAAAD1Rva2VuTm90QWxsb3dlZAAAAAQKAAAAaWBzZW5kYCB3YXMgY2FsbGVkIGJlZm9yZSBhbiBhZG1pbiBjb25maWd1cmVkIHRoZSB0b2tlbi13cmFwcGVyCmNvbnRyYWN0IGluc3RhbmNlIHZpYSBgc2V0X3Rva2VuX3dyYXBwZXJgLgAAAAAAABJUb2tlbldyYXBwZXJOb3RTZXQAAAAABAsAAACBVGhlIGB0b2tlbi13cmFwcGVyOjp0cmFuc2Zlcl9mcm9tYCBjYWxsIGBzZW5kYCBtYWtlcyBmYWlsZWQgKGUuZy4KaW5zdWZmaWNpZW50L2V4cGlyZWQgYWxsb3dhbmNlKSBvciBjb3VsZCBub3QgYmUgaW52b2tlZCBhdCBhbGwuAAAAAAAAE1Rva2VuVHJhbnNmZXJGYWlsZWQAAAAEDAAAAGtgcHJvcG9zZV91cGdyYWRlYCdzIGBkZWxheV9pbl9sZWRnZXJzYCBpcyBiZWxvdwpbYEdsb2JlV2FsbGV0OjpNSU5fVVBHUkFERV9ERUxBWV9MRURHRVJTYF0gKHNlZSBpc3N1ZSAjODQpLgAAAAAUVXBncmFkZURlbGF5VG9vU2hvcnQAAAQNAAAAcGBzZXRfcmVjb3ZlcnlfY29uZmlnYCdzIGBkZWxheV9pbl9sZWRnZXJzYCBpcyBiZWxvdwpbYEdsb2JlV2FsbGV0OjpNSU5fUkVDT1ZFUllfREVMQVlfTEVER0VSU2BdIChzZWUgaXNzdWUgIzg0KS4AAAAVUmVjb3ZlcnlEZWxheVRvb1Nob3J0AAAAAAAEDg==",
        "AAAAAAAAAEBSZXR1cm4gdGhlIGxpc3Qgb2YgYWxsIGFsbG93ZWQgdG9rZW4gY29udHJhY3QgYWRkcmVzc2VzIChhbGlhcykuAAAADmFsbG93ZWRfdG9rZW5zAAAAAAAAAAAAAQAAA+oAAAAT",
        "AAAAAAAAAKhMZWdhY3kgc2luZ2xlLXN0ZXAgYWRtaW4gdHJhbnNmZXIuCgpEZXByZWNhdGVkIGluIGZhdm9yIG9mIGBwcm9wb3NlX2FkbWluYCArIGBhY2NlcHRfYWRtaW5gLgoKIyBFcnJvcnMKKiBbYFdhbGxldEVycm9yOjpOb3RJbml0aWFsaXplZGBdIC8gW2BXYWxsZXRFcnJvcjo6VW5hdXRob3JpemVkYF0AAAAOdHJhbnNmZXJfYWRtaW4AAAAAAAIAAAAAAAAAB2N1cnJlbnQAAAAAEwAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAC1dhbGxldEVycm9yAA==",
        "AAAAAAAAASNUaGUgY3VycmVudCBhZG1pbiBjYW5jZWxzIGEgcGVuZGluZyByZWNvdmVyeS4gVGhpcyBpcyB0aGUgcHJpbWFyeQphYnVzZS9ncmllZmluZyBkZWZlbnNlOiBhcyBsb25nIGFzIHRoZSBsZWdpdGltYXRlIGFkbWluIGtleSBpcyBzdGlsbAp1c2FibGUsIGEgY29sbHVkaW5nIGd1YXJkaWFuIG1ham9yaXR5IGNhbiBiZSBzdG9wcGVkIGF0IGFueSBwb2ludApiZWZvcmUgYGV4ZWN1dGVfcmVjb3ZlcnlgIHN1Y2NlZWRzIOKAlCBpbmNsdWRpbmcgYWZ0ZXIgcXVvcnVtLCBkdXJpbmcKdGhlIHRpbWVsb2NrIHdpbmRvdy4AAAAAD2NhbmNlbF9yZWNvdmVyeQAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAABAAAD6QAAA+0AAAAAAAAH0AAAAAtXYWxsZXRFcnJvcgA=",
        "AAAAAAAABABFeGVjdXRlIGEgcHJldmlvdXNseSBwcm9wb3NlZCB1cGdyYWRlIGFmdGVyIHRoZSB0aW1lbG9jayBlbGFwc2VzLgoKVGhpcyBmdW5jdGlvbiB2YWxpZGF0ZXMgdGhhdDoKMS4gQSBwcm9wb3NhbCBleGlzdHMgYW5kIGlzIHN0b3JlZCBpbiBpbnN0YW5jZSBzdG9yYWdlCjIuIFRoZSBwcm92aWRlZCBgd2FzbV9oYXNoYCBtYXRjaGVzIHRoZSBwcm9wb3NlZCBoYXNoICh2aWEgZXF1YWxpdHkgY2hlY2spCjMuIFRoZSBjdXJyZW50IGxlZGdlciBzZXF1ZW5jZSBoYXMgcmVhY2hlZCBvciBleGNlZWRlZCBgcmVhZHlfYXRgICh0aW1lbG9jayBlbGFwc2VkKQo0LiBUaGUgYHdhc21faGFzaGAgd2FzIHByZXZpb3VzbHkgcmVnaXN0ZXJlZCBvbi1jaGFpbiB2aWEgW2BFbnY6OmRlcGxveWVyKCkudXBsb2FkX2NvbnRyYWN0X3dhc20oKWBdCgojIEVycm9ycwoqIFtgV2FsbGV0RXJyb3I6OlVwZ3JhZGVOb3RQZW5kaW5nYF0g4oCUIG5vIHBlbmRpbmcgdXBncmFkZSBwcm9wb3NhbAoqIFtgV2FsbGV0RXJyb3I6OlVwZ3JhZGVIYXNoTWlzbWF0Y2hgXSDigJQgcHJvdmlkZWQgaGFzaCBkb2Vzbid0IG1hdGNoIHN0b3JlZCBwcm9wb3NhbAoqIFtgV2FsbGV0RXJyb3I6OlVwZ3JhZGVOb3RSZWFkeWBdIOKAlCB0aW1lbG9jayBoYXMgbm90IHlldCBlbGFwc2VkCiogW2BXYWxsZXRFcnJvcjo6VXBncmFkZVdhc21Ob3RVcGxvYWRlZGBdIOKAlCB3YXNtIGhhc2ggd2FzIG5ldmVyIHJlZ2lzdGVyZWQgb24tY2hhaW4KCiMgT3BlcmF0aW9uYWwgTm90ZXMKQ29ycmVjdCB1cGdyYWRlIHNlcXVlbmNlIGlzOgoxLiBVcGxvYWQgbmV3IGNvbnRyYWN0IFdBU00gdmlhIGEgc2VwYXJhdGUgdHJhbnNhY3Rpb24g4oaSIG9idGFpbiB3YXNtX2hhc2gKMi4gQ2FsbCBgcHJvcG9zZV91cGdyYWRlYCB3aXRoIHRoYXQgaGFzaCBhbmQgZGVzaXJlZCBkZWxheQozLiBXYWl0IGZvciB0aGUgZGVsYXkgKGluIGxlZGdlcnMpIHRvIGVsYXBzZQo0LiBDYWxsIGBleGVjdXRlX3VwZ3JhZGVgIHdpdGggdGhlIHNhbWUgaGFzaAoKSWYgYSBXQVNNIGJsb2IgAAAAD2V4ZWN1dGVfdXBncmFkZQAAAAACAAAAAAAAAAhleGVjdXRvcgAAABMAAAAAAAAACXdhc21faGFzaAAAAAAAA+4AAAAgAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAALV2FsbGV0RXJyb3IA",
        "AAAAAAAAAEBHZXQgdGhlIGRhaWx5IHNwZW5kIGxpbWl0IGZvciBhIHVzZXIvYXNzZXQgcGFpciAoMCA9IHVubGltaXRlZCkuAAAAD2dldF9zcGVuZF9saW1pdAAAAAACAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAAKYXNzZXRfY29kZQAAAAAAEAAAAAEAAAAL",
        "AAAAAAAAALpBbW91bnQgc3BlbnQgYnkgYHVzZXJgIGluIGBhc3NldF9jb2RlYCBkdXJpbmcgdGhlIGN1cnJlbnQgZGF5IHdpbmRvdwooaXNzdWUgIzUwKS4gTWlycm9ycyBgcmVjb3JkX3NwZW5kYCdzIHdpbmRvdyBsb2dpYyBleGFjdGx5OiBhIHN0b3JlZApyZWNvcmQgZnJvbSBhbiBlYXJsaWVyIGBkYXlgIGJ1Y2tldCBjb3VudHMgYXMgMC4AAAAAAA9nZXRfc3BlbnRfdG9kYXkAAAAAAgAAAAAAAAAEdXNlcgAAABMAAAAAAAAACmFzc2V0X2NvZGUAAAAAABAAAAABAAAACw==",
        "AAAAAAAAACxSZXR1cm4gdGhlIHBlbmRpbmcgdXBncmFkZSBwcm9wb3NhbCwgaWYgYW55LgAAAA9wZW5kaW5nX3VwZ3JhZGUAAAAAAAAAAAEAAAPoAAAH0AAAAA9VcGdyYWRlUHJvcG9zYWwA",
        "AAAAAAAAA2pRdWV1ZSBhbiB1cGdyYWRlIGZvciBsYXRlciBleGVjdXRpb24uCgpUaGUgcHJvcG9zYWwgaXMgc3RvcmVkIGluIGNvbnRyYWN0IGluc3RhbmNlIHN0b3JhZ2UgYW5kIGVtaXR0ZWQgYXMgYW4KZXZlbnQgc28gdGhlIHVwZ3JhZGUgaXMgdmlzaWJsZSBvbi1jaGFpbiBiZWZvcmUgYW55IGNvZGUgc3dhcCBvY2N1cnMuCgpUaGUgcHJvdmlkZWQgYHdhc21faGFzaGAgaXMgc3RvcmVkIGFzLWlzICp3aXRob3V0IHZhbGlkYXRpb24qIOKAlCBpdCBpcwp0aGUgY2FsbGVyJ3MgcmVzcG9uc2liaWxpdHkgdG8gZW5zdXJlIGl0IG1hdGNoZXMgYSBibG9iIHByZXZpb3VzbHkgdXBsb2FkZWQKb24tY2hhaW4gdmlhIFtgRW52OjpkZXBsb3llcigpLnVwbG9hZF9jb250cmFjdF93YXNtKClgXS4gTm8gcHJlLWNoZWNrIGlzCnBlcmZvcm1lZCBoZXJlOyB2YWxpZGF0aW9uIG9jY3VycyB3aGVuIGBleGVjdXRlX3VwZ3JhZGVgIGlzIGNhbGxlZC4KCiMgRXJyb3JzCiogW2BXYWxsZXRFcnJvcjo6VXBncmFkZUFscmVhZHlQZW5kaW5nYF0g4oCUIGFuIHVwZ3JhZGUgaXMgYWxyZWFkeSBxdWV1ZWQKKiBbYFdhbGxldEVycm9yOjpVbmF1dGhvcml6ZWRgXSDigJQgY2FsbGVyIGlzIG5vdCB0aGUgY3VycmVudCBhZG1pbgoqIFtgV2FsbGV0RXJyb3I6OlVwZ3JhZGVEZWxheVRvb1Nob3J0YF0g4oCUIGBkZWxheV9pbl9sZWRnZXJzYCBpcyBiZWxvdwpbYFNlbGY6Ok1JTl9VUEdSQURFX0RFTEFZX0xFREdFUlNgXSAoc2VlIGlzc3VlICM4NCkKClNlZSBbYFNlbGY6OmV4ZWN1dGVfdXBncmFkZWBdIGZvciBvcGVyYXRpb25hbCBub3RlcyBhbmQgdGhlIGNvcnJlY3QKc2VxdWVuY2Ugb2Ygc3RlcHMgKHVwbG9hZCDihpIgcHJvcG9zZSDihpIgd2FpdCDihpIgZXhlY3V0ZSkuAAAAAAAPcHJvcG9zZV91cGdyYWRlAAAAAAMAAAAAAAAACHByb3Bvc2VyAAAAEwAAAAAAAAAJd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAAAAAAEGRlbGF5X2luX2xlZGdlcnMAAAAEAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAALV2FsbGV0RXJyb3IA",
        "AAAAAAAAADJSZXR1cm4gdGhlIGN1cnJlbnQgcmVjb3ZlcnkgY29uZmlndXJhdGlvbiwgaWYgYW55LgAAAAAAD3JlY292ZXJ5X2NvbmZpZwAAAAAAAAAAAQAAA+gAAAfQAAAADlJlY292ZXJ5Q29uZmlnAAA=",
        "AAAAAAAABABSZW1vdmUgYSBndWFyZGlhbi4gQWRtaW4tYXV0aG9yaXplZC4KCklmIGEgcmVjb3ZlcnkgcHJvcG9zYWwgaXMgY3VycmVudGx5IHBlbmRpbmcgYW5kIHRoZSByZW1vdmVkIGd1YXJkaWFuCmhhZCBhbHJlYWR5IGFwcHJvdmVkIGl0LCB0aGF0IGFwcHJvdmFsIGlzIHN0cmlwcGVkIGZyb20gdGhlIHByb3Bvc2FsCmFzIHBhcnQgb2YgdGhpcyBzYW1lIGNhbGwgKGRlc2lnbiBkZWNpc2lvbiAoYSkgZnJvbSBpc3N1ZSAjMjYsIGNob3NlbgpvdmVyIGRvY3VtZW50aW5nIHRoZSByZW1vdmFsIGFzIGFwcHJvdmFsLXByZXNlcnZpbmcpOiBhbiBhZG1pbiB3aG8KcmVtb3ZlcyBhIGd1YXJkaWFuIGJlY2F1c2UgdGhleSBubyBsb25nZXIgdHJ1c3QgdGhhdCBndWFyZGlhbidzIGtleQptdXN0IG5vdCBoYXZlIGEgc2luY2UtcmV2b2tlZCBndWFyZGlhbidzIHZvdGUgc3RpbGwgYWJsZSB0byBwdXNoIGEKcmVjb3ZlcnkgdG8gcXVvcnVtIGFuZCBjb21wbGV0aW9uLiBJZiBzdHJpcHBpbmcgdGhlIGFwcHJvdmFsIGRyb3BzCnRoZSBwcm9wb3NhbCBiYWNrIGJlbG93IGBSZWNvdmVyeUNvbmZpZy50aHJlc2hvbGRgLCBgcmVhZHlfYXRgIGlzCmNsZWFyZWQgZXhhY3RseSBhcyBgcmV2b2tlX3JlY292ZXJ5X2FwcHJvdmFsYCBhbHJlYWR5IGRvZXMgb24gaXRzIG93bgpiZWxvdy10aHJlc2hvbGQgcGF0aCwgc28gdGhlIHRpbWVsb2NrIGhhcyB0byBiZSByZS1hcm1lZCBieSBhIGZyZXNoCnJvdW5kIG9mIGFwcHJvdmFscyByYXRoZXIgdGhhbiBzaWxlbnRseSBrZWVwaW5nIGEgc3RhbGUgY291bnRkb3duCmFsaXZlIG9uIGEgbm93LXVuZGVyLXF1b3J1bSBwcm9wb3NhbC4gVGhpcyBtdXRhdGlvbiBjYW5ub3QgaXRzZWxmCmZhaWw6IGl0IGNhbiBvbmx5IGV2ZXIgcmVtb3ZlIGFuIGVudHJ5IGZyb20gYSBgVmVjYC9jbGVhciBhbgpgT3B0aW9uYCwgbmVpdGhlciBvZiB3aGljaCBoYXMgYSBmYWxsaWJsZSBwcmVjb25kaXRpb24uCgojIEVycm9ycwoqIFtgV2FsbGV0RXJyb3I6Ok5vdEVub3VnaEd1YXJkaWFuc2BdIOKAlCB3b3VsAAAAD3JlbW92ZV9ndWFyZGlhbgAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACGd1YXJkaWFuAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAC1dhbGxldEVycm9yAA==",
        "AAAAAAAAAiNTZXQgYSBkYWlseSBzcGVuZCBsaW1pdCAoaW4gc3Ryb29wcykgZm9yIGEgc3BlY2lmaWMgYXNzZXQuCgpgbGltaXQgPSAwYCByZW1vdmVzIHRoZSBsaW1pdCAodW5saW1pdGVkKS4KCioqUmV0cm9hY3RpdmUgZW5mb3JjZW1lbnQ6KiogaWYgdGhlIHVzZXIgaGFzIGFscmVhZHkgc3BlbnQgbW9yZSB0aGFuCnRoZSBwcm9wb3NlZCBuZXcgbGltaXQgaW4gdGhlIGN1cnJlbnQgZGF5IHdpbmRvdywgdGhlIGNhbGwgaXMgcmVqZWN0ZWQKd2l0aCBgU3BlbmRMaW1pdEV4Y2VlZGVkYC4gVGhpcyBwcmV2ZW50cyBhIGxpbWl0LWxvd2VyaW5nIGZyb20Kc2lsZW50bHkgZ3JhbnRpbmcgaGVhZHJvb20gdGhhdCB3YXMgb25seSB2YWxpZCB1bmRlciB0aGUgb2xkLCBoaWdoZXIKbGltaXQuCgojIEVycm9ycwoqIFtgV2FsbGV0RXJyb3I6OkludmFsaWRTcGVuZExpbWl0YF0g4oCUIG5lZ2F0aXZlIGxpbWl0LgoqIFtgV2FsbGV0RXJyb3I6OlNwZW5kTGltaXRFeGNlZWRlZGBdIOKAlCBjdXJyZW50IGRheSdzIHNwZW5kIGFscmVhZHkKZXhjZWVkcyB0aGUgcHJvcG9zZWQgbGltaXQuAAAAAA9zZXRfc3BlbmRfbGltaXQAAAAAAwAAAAAAAAAEdXNlcgAAABMAAAAAAAAACmFzc2V0X2NvZGUAAAAAABAAAAAAAAAABWxpbWl0AAAAAAAACwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAC1dhbGxldEVycm9yAA==",
        "AAAAAAAAALJBIGd1YXJkaWFuIGFwcHJvdmVzIHRoZSBwZW5kaW5nIHJlY292ZXJ5IHByb3Bvc2FsLgoKT25jZSBhcHByb3ZhbHMgcmVhY2ggdGhlIGNvbmZpZ3VyZWQgdGhyZXNob2xkLCB0aGUgdGltZWxvY2sgaXMKYXJtZWQ6IGByZWFkeV9hdCA9IGN1cnJlbnRfbGVkZ2VyX3NlcXVlbmNlICsgZGVsYXlfaW5fbGVkZ2Vyc2AuAAAAAAAQYXBwcm92ZV9yZWNvdmVyeQAAAAEAAAAAAAAACGd1YXJkaWFuAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAC1dhbGxldEVycm9yAA==",
        "AAAAAAAABABFeGVjdXRlIGEgcmVjb3Zlcnkgb25jZSBxdW9ydW0gaGFzIGJlZW4gcmVhY2hlZCBhbmQgdGhlIHRpbWVsb2NrIGhhcwplbGFwc2VkLiBDYWxsYWJsZSBieSBhbnlvbmUgKHR5cGljYWxseSBhIGd1YXJkaWFuIG9yIHRoZSBuZXcgYWRtaW4KY2FuZGlkYXRlKSDigJQgYXV0aG9yaXphdGlvbiBjb21lcyBlbnRpcmVseSBmcm9tIHRoZSBndWFyZGlhbgpzaWduYXR1cmVzIGFscmVhZHkgcmVjb3JkZWQgb24gdGhlIHByb3Bvc2FsLCBub3QgZnJvbSB0aGUgY2FsbGVyLgoKRGVsaWJlcmF0ZWx5IGRvZXMgKipub3QqKiBjYWxsIGByZXF1aXJlX2FkbWluYC9gY3VycmVudC5yZXF1aXJlX2F1dGgoKWA6CnRoYXQgaXMgcHJlY2lzZWx5IHRoZSBjYXBhYmlsaXR5IHRoYXQgaXMgdW5hdmFpbGFibGUgd2hlbiBhIGRldmljZSBpcwpsb3N0LiBSZS1jaGVja3MgcXVvcnVtIGF0IGV4ZWN1dGlvbiB0aW1lIChub3QganVzdCBhdApgYXBwcm92ZV9yZWNvdmVyeWAgdGltZSkgaW4gY2FzZSBhIGd1YXJkaWFuIHJldm9rZWQgYmV0d2VlbiBxdW9ydW0KYW5kIHRpbWVsb2NrIGV4cGlyeSBpbiBhIHdheSB0aGlzIGNvbnRyYWN0IGRpZG4ndCBvYnNlcnZlIChkZWZlbnNlIGluCmRlcHRoOyBgcmV2b2tlX3JlY292ZXJ5X2FwcHJvdmFsYCBhbHJlYWR5IGNsZWFycyBgcmVhZHlfYXRgLCBidXQgdGhpcwpndWFyZHMgYWdhaW5zdCBhbnkgZnV0dXJlIGNvZGUgcGF0aCB0aGF0IGZvcmdldHMgdG8pLgoKQW55IGluLWZsaWdodCAqbm9ybWFsKiBgcHJvcG9zZV9hZG1pbmAvYGFjY2VwdF9hZG1pbmAgdHJhbnNmZXIgaXMKY2FuY2VsbGVkIGFzIHBhcnQgb2YgZXhlY3V0aW5nIGEgcmVjb3ZlcnksIHNvIHRoZSB0d28gZmxvd3MgY2FuJ3QgcmFjZS4KCiMgRXZlbnRzIChzZWUgaXNzdWUgIzkxKQpQdWJsaXNoZXMgKip0d28qKiBldmVudHMsIGRlbGliZXJhdGVseSwgbm90IG9uZToKMS4gYGFkbWluX3RyYW5zZmVycmVkYCDigJQgaWRlbnRpY2FsIHRvcGljIGFuZCBwYXlsb2FkIHNoYXBlIHRvIHdoYXQKYGFjY2VwdF9hZG1pbmAgcHViAAAAEGV4ZWN1dGVfcmVjb3ZlcnkAAAAAAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAALV2FsbGV0RXJyb3IA",
        "AAAAAAAAAD9SZXR1cm5zIHdoZXRoZXIgYHRva2VuX2lkYCBpcyBjdXJyZW50bHkgYWxsb3dsaXN0ZWQgZm9yIGBzZW5kYC4AAAAAEGlzX3Rva2VuX2FsbG93ZWQAAAABAAAAAAAAAAh0b2tlbl9pZAAAABMAAAABAAAAAQ==",
        "AAAAAQAAAAAAAAAAAAAADlJlY292ZXJ5Q29uZmlnAAAAAAACAAAAr0xlZGdlci1jb3VudCBkZWxheSBiZXR3ZWVuIHJlYWNoaW5nIHF1b3J1bSBhbmQgYGV4ZWN1dGVfcmVjb3ZlcnlgCmJlY29taW5nIGNhbGxhYmxlLiBHaXZlcyB0aGUgbGVnaXRpbWF0ZSBhZG1pbiBhIHdpbmRvdyB0byBub3RpY2UKYW5kIGNhbmNlbCBhIG1hbGljaW91cyBvciBtaXN0YWtlbiByZWNvdmVyeS4AAAAAEGRlbGF5X2luX2xlZGdlcnMAAAAEAAAAP051bWJlciBvZiBkaXN0aW5jdCBndWFyZGlhbiBhcHByb3ZhbHMgcmVxdWlyZWQgdG8gcmVhY2ggcXVvcnVtLgAAAAAJdGhyZXNob2xkAAAAAAAABA==",
        "AAAAAQAAAYRSZWFkLW9ubHkgdmlldyBvZiBhIHVzZXIncyBkYWlseSBzcGVuZCB3aW5kb3cgZm9yIG9uZSBhc3NldCwgcmV0dXJuZWQgYnkKW2BHbG9iZVdhbGxldDo6Z2V0X3NwZW5kX2FsbG93YW5jZWBdIChpc3N1ZSAjNTApLgoKVGhlIHdpbmRvdyBpcyB0aGUgc2FtZSA4NiA0MDAtc2Vjb25kIGJ1Y2tldCBgcmVjb3JkX3NwZW5kYCB1c2VzOgpgZGF5ID0gbGVkZ2VyX3RpbWVzdGFtcCAvIDg2NDAwYC4gTGVkZ2VyIHRpbWVzdGFtcHMgYXJlIFVuaXggc2Vjb25kcywgc28Kd2luZG93cyBzdGFydCBhbmQgZW5kIGV4YWN0bHkgYXQgMDA6MDA6MDAgVVRDICphcyBtZWFzdXJlZCBieSBsZWRnZXIKY2xvc2UgdGltZSosIG5vdCB3YWxsLWNsb2NrIHRpbWUgb24gYW55IGNsaWVudCBvciBzZXJ2ZXIuAAAAAAAAAA5TcGVuZEFsbG93YW5jZQAAAAAABQAAACVDb25maWd1cmVkIGRhaWx5IGNhcCAoMCA9IHVubGltaXRlZCkuAAAAAAAABWxpbWl0AAAAAAAACwAAAIFgbGltaXQgLSBzcGVudGAsIGZsb29yZWQgYXQgMC4gMCB3aGVuIGBsaW1pdCA9PSAwYCDigJQgY2FsbGVycyBtdXN0CmNoZWNrIGBsaW1pdGAgdG8gZGlzdGluZ3Vpc2ggInVubGltaXRlZCIgZnJvbSAibm90aGluZyBsZWZ0Ii4AAAAAAAAJcmVtYWluaW5nAAAAAAAACwAAAIVBbW91bnQgcmVjb3JkZWQgaW4gdGhlIGN1cnJlbnQgd2luZG93LiBBbHdheXMgMCB3aGVuIGBsaW1pdCA9PSAwYCwKYmVjYXVzZSBgcmVjb3JkX3NwZW5kYCBkb2VzIG5vdCB0cmFjayBzcGVuZHMgZm9yIHVubGltaXRlZCBhc3NldHMuAAAAAAAABXNwZW50AAAAAAAACwAAAFhMZWRnZXIgdGltZXN0YW1wIChVbml4IHNlY29uZHMpIGF0IHdoaWNoIHRoZSBuZXh0IHdpbmRvdyBiZWdpbnMgYW5kCmBzcGVudGAgcmVzZXRzIHRvIDAuAAAAEHdpbmRvd19yZXNldHNfYXQAAAAGAAAAQkxlZGdlciB0aW1lc3RhbXAgKFVuaXggc2Vjb25kcykgYXQgd2hpY2ggdGhlIGN1cnJlbnQgd2luZG93IGJlZ2FuLgAAAAAADHdpbmRvd19zdGFydAAAAAY=",
        "AAAAAAAAAX5BZG1pbjogYWRkIGB0b2tlbl9pZGAgdG8gdGhlIHNldCBvZiB0b2tlbnMgYHNlbmRgIGlzIHBlcm1pdHRlZCB0byBtb3ZlLgoKVGhpcyBpcyBhIGdvdmVybmFuY2UvY3VyYXRpb24gZGVjaXNpb24sIG5vdCBzb21ldGhpbmcgdGhpcyBjb250cmFjdApjYW4gdmVyaWZ5IG9uLWNoYWluIOKAlCB0aGUgYWRtaW4gaXMgZXhwZWN0ZWQgdG8gaGF2ZSBjb25maXJtZWQKYHRva2VuX2lkYCBpbXBsZW1lbnRzIHRoZSBzdGFuZGFyZCB0b2tlbiBpbnRlcmZhY2UgY29ycmVjdGx5IGFuZApyZXByZXNlbnRzIGEgcmVhbCwgdmFsdWVkIGFzc2V0IGJlZm9yZSBhbGxvd2xpc3RpbmcgaXQuIFNlZQpkb2NzL2Rlc2lnbi93aXJpbmctcmVlbnRyYW5jeS10aHJlYXQtbW9kZWwubWQgwqc0LTUuAAAAAAARYWRkX2FsbG93ZWRfdG9rZW4AAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACHRva2VuX2lkAAAAEwAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAC1dhbGxldEVycm9yAA==",
        "AAAAAAAAAElSZXR1cm5zIHRoZSBjdXJyZW50bHkgY29uZmlndXJlZCB0b2tlbi13cmFwcGVyIGNvbnRyYWN0IGluc3RhbmNlLCBpZiBhbnkuAAAAAAAAEWdldF90b2tlbl93cmFwcGVyAAAAAAAAAAAAAAEAAAPoAAAAEw==",
        "AAAAAAAAAP1BIGd1YXJkaWFuIGluaXRpYXRlcyBhIHJlY292ZXJ5IHRvIGBuZXdfYWRtaW5gLiBDb3VudHMgYXMgdGhhdApndWFyZGlhbidzIG93biBhcHByb3ZhbC4KCiMgRXJyb3JzCiogW2BXYWxsZXRFcnJvcjo6UmVjb3ZlcnlOb3RDb25maWd1cmVkYF0KKiBbYFdhbGxldEVycm9yOjpVbmF1dGhvcml6ZWRgXSDigJQgY2FsbGVyIGlzIG5vdCBhIHJlZ2lzdGVyZWQgZ3VhcmRpYW4uCiogW2BXYWxsZXRFcnJvcjo6UmVjb3ZlcnlBbHJlYWR5UGVuZGluZ2BdAAAAAAAAEWluaXRpYXRlX3JlY292ZXJ5AAAAAAAAAgAAAAAAAAAIZ3VhcmRpYW4AAAATAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAALV2FsbGV0RXJyb3IA",
        "AAAAAAAAAC1SZXR1cm4gdGhlIHBlbmRpbmcgcmVjb3ZlcnkgcHJvcG9zYWwsIGlmIGFueS4AAAAAAAARcmVjb3ZlcnlfcHJvcG9zYWwAAAAAAAAAAAAAAQAAA+gAAAfQAAAAEFJlY292ZXJ5UHJvcG9zYWw=",
        "AAAAAAAAAEFBZG1pbjogc2V0IHRoZSB0b2tlbi13cmFwcGVyIGNvbnRyYWN0IGluc3RhbmNlIGBzZW5kYCBjYWxscyBpbnRvLgAAAAAAABFzZXRfdG9rZW5fd3JhcHBlcgAAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAQdG9rZW5fd3JhcHBlcl9pZAAAABMAAAABAAAD6QAAA+0AAAAAAAAH0AAAAAtXYWxsZXRFcnJvcgA=",
        "AAAAAQAAAAAAAAAAAAAAD1VwZ3JhZGVQcm9wb3NhbAAAAAADAAAAAAAAAAtwcm9wb3NlZF9ieQAAAAATAAAAAAAAAAhyZWFkeV9hdAAAAAQAAAAAAAAACXdhc21faGFzaAAAAAAAA+4AAAAg",
        "AAAAAAAAADhSZXR1cm4gdGhlIGxpc3Qgb2YgYWxsIGFsbG93ZWQgdG9rZW4gY29udHJhY3QgYWRkcmVzc2VzLgAAABJnZXRfYWxsb3dlZF90b2tlbnMAAAAAAAAAAAABAAAD6gAAABM=",
        "AAAAAQAAAAAAAAAAAAAAEFJlY292ZXJ5UHJvcG9zYWwAAAADAAAAAAAAAAlhcHByb3ZhbHMAAAAAAAPqAAAAEwAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAI1TZXQgb25jZSBxdW9ydW0gaXMgZmlyc3QgcmVhY2hlZDsgY2xlYXJlZCBhZ2FpbiBpZiBhcHByb3ZhbHMgZHJvcApiYWNrIGJlbG93IHRocmVzaG9sZC4gYGV4ZWN1dGVfcmVjb3ZlcnlgIHJlcXVpcmVzIGBsZWRnZXIgc2VxID49IHJlYWR5X2F0YC4AAAAAAAAIcmVhZHlfYXQAAAPoAAAABA==",
        "AAAAAAAAAK1MaW1pdCwgc3BlbnQgYW5kIHJlbWFpbmluZyBhbW91bnRzIGZvciB0aGUgY3VycmVudCBkYXkgd2luZG93LCBwbHVzCnRoZSBsZWRnZXIgdGltZXN0YW1wcyBib3VuZGluZyBpdCAoaXNzdWUgIzUwKS4gUmVhZC1vbmx5OyBpbnRlbmRlZCB0bwpiZSBzaW11bGF0ZWQgcmF0aGVyIHRoYW4gc3VibWl0dGVkLgAAAAAAABNnZXRfc3BlbmRfYWxsb3dhbmNlAAAAAAIAAAAAAAAABHVzZXIAAAATAAAAAAAAAAphc3NldF9jb2RlAAAAAAAQAAAAAQAAB9AAAAAOU3BlbmRBbGxvd2FuY2UAAA==",
        "AAAAAAAAAcxBZG1pbiBhbmQgdXNlcjogdHJpbSBhIHVzZXIncyBhc3NldCBsaXN0IHRvIFtgR2xvYmVXYWxsZXQ6Ok1BWF9BU1NFVFNgXSBpZiBpdCBleGNlZWRzIHRoZSBib3VuZC4KUmV0dXJucyB0aGUgbnVtYmVyIG9mIGFzc2V0cyB0cmltbWVkICgwIGlmIGFscmVhZHkgd2l0aGluIGxpbWl0KS4KCiMgQXV0aG9yaXphdGlvbiBEZWNpc2lvbgpEdWFsIGF1dGhvcml6YXRpb24gaXMgcmVxdWlyZWQ6IGBhZG1pbi5yZXF1aXJlX2F1dGgoKWAgZW5zdXJlcyBvbmx5IGFuCmFkbWluaXN0cmF0b3IgY2FuIGluaXRpYXRlIGEgbWlncmF0aW9uLCB3aGlsZSBgdXNlci5yZXF1aXJlX2F1dGgoKWAKcHJlc2VydmVzIHRoZSBzZWxmLXNvdmVyZWlnbiBwcm9wZXJ0eSBvZiB0aGUgd2FsbGV0IGJ5IGVuc3VyaW5nIHRoZQp1c2VyIGNvbnNlbnRzIHRvIHRoZSBleGFjdCBhc3NldCBsaXN0IG1vZGlmaWNhdGlvbiB0YWtpbmcgcGxhY2UuAAAAE21pZ3JhdGVfdXNlcl9hc3NldHMAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAR1c2VyAAAAEwAAAAEAAAPpAAAABAAAB9AAAAALV2FsbGV0RXJyb3IA",
        "AAAAAAAABABDb25maWd1cmUgKG9yIHJlY29uZmlndXJlKSB0aGUgTS1vZi1OIHJlY292ZXJ5IHRocmVzaG9sZCBhbmQgdGhlCnBvc3QtcXVvcnVtIHRpbWVsb2NrIGRlbGF5LiBBZG1pbi1hdXRob3JpemVkLgoKIyMgRGVzaWduIGRlY2lzaW9uOiByZWplY3RlZCB3aGlsZSBhIHJlY292ZXJ5IGlzIHBlbmRpbmcgKGlzc3VlICMyOCkKQSBgUmVjb3ZlcnlQcm9wb3NhbGAncyBgcmVhZHlfYXRgIGlzIGNvbXB1dGVkIG9uY2UsIGF0IHRoZSBtb21lbnQKcXVvcnVtIGlzIHJlYWNoZWQgaW4gYGFwcHJvdmVfcmVjb3ZlcnlgLCBhbmQgZnJvemVuIGludG8gc3RvcmFnZSDigJQKaXQgZG9lcyBub3QgcmV0cm9hY3RpdmVseSB0cmFjayBsYXRlciBgZGVsYXlfaW5fbGVkZ2Vyc2AgY2hhbmdlcy4KTWVhbndoaWxlIGBleGVjdXRlX3JlY292ZXJ5YCdzIHF1b3J1bSBjaGVjayByZWFkcyB0aGUgKmxpdmUqCmBSZWNvdmVyeUNvbmZpZy50aHJlc2hvbGRgLCBub3QgdGhlIGNvbmZpZyBpbiBlZmZlY3Qgd2hlbiBxdW9ydW0gd2FzCnJlYWNoZWQuIFRoYXQgaGFsZi1saXZlLCBoYWxmLWZyb3plbiBjb3VwbGluZyBpcyBjb25mdXNpbmcgZW5vdWdoCihhbmQgdW5kZXJ0ZXN0ZWQgZW5vdWdoIOKAlCBzZWUgIzI4KSB0aGF0IHRoZSBzYWZlciBkZXNpZ24gaXMgdG8KZGlzYWxsb3cgdGhlIGFtYmlndWl0eSBvdXRyaWdodDogd2hpbGUgYSBgUmVjb3ZlcnlQcm9wb3NhbGAgZXhpc3RzLApgc2V0X3JlY292ZXJ5X2NvbmZpZ2AgaXMgcmVqZWN0ZWQgd2l0aCBbYFdhbGxldEVycm9yOjpSZWNvdmVyeUFscmVhZHlQZW5kaW5nYF0uCkFuIGFkbWluIHdobyB3YW50cyB0byBjaGFuZ2UgdGhlIHRocmVzaG9sZC9kZWxheSB3aGlsZSBhIHJlY292ZXJ5IGlzCmluIGZsaWdodCBtdXN0IGZpcnN0IGNhbGwgYGNhbmNlbF9yZWNvdmVyeWAgKGlmIHJlYWNoYWJsZSkg4oCUIHRoZQphbHJlYWR5LWV4aXN0aW5nLCB1bmFtYmlndW91cyB3YXkgdG8gc3RvcCBhIHBlbmRpbmcgcHJvcG9zYWwg4oCUIHJhdGhlcgp0aGFuIG11dGF0ZSBjb25maWcgdW5kZXJuAAAAE3NldF9yZWNvdmVyeV9jb25maWcAAAAAAwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAl0aHJlc2hvbGQAAAAAAAAEAAAAAAAAABBkZWxheV9pbl9sZWRnZXJzAAAABAAAAAEAAAPpAAAD7QAAAAAAAAfQAAAAC1dhbGxldEVycm9yAA==",
        "AAAAAAAAADFBZG1pbjogcmVtb3ZlIGB0b2tlbl9pZGAgZnJvbSB0aGUgc2VuZC1hbGxvd2xpc3QuAAAAAAAAFHJlbW92ZV9hbGxvd2VkX3Rva2VuAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAh0b2tlbl9pZAAAABMAAAABAAAD6QAAA+0AAAAAAAAH0AAAAAtXYWxsZXRFcnJvcgA=",
        "AAAAAAAAACpDYW5jZWwgdGhlIGN1cnJlbnQgcGVuZGluZyBhZG1pbiBwcm9wb3NhbC4AAAAAABVjYW5jZWxfYWRtaW5fdHJhbnNmZXIAAAAAAAABAAAAAAAAAAdjdXJyZW50AAAAABMAAAABAAAD6QAAA+0AAAAAAAAH0AAAAAtXYWxsZXRFcnJvcgA=",
        "AAAAAAAAAqxBIGd1YXJkaWFuIHJldm9rZXMgdGhlaXIgb3duIGFwcHJvdmFsIG9mIHRoZSBwZW5kaW5nIHJlY292ZXJ5LgoKSWYgYXBwcm92YWxzIGRyb3AgYmVsb3cgdGhyZXNob2xkLCB0aGUgdGltZWxvY2sgaXMgZGlzYXJtZWQKKGByZWFkeV9hdGAgY2xlYXJlZCkg4oCUIHF1b3J1bSBtdXN0IGJlIHJlYWNoZWQgYWdhaW4gZnJvbSBzY3JhdGNoLApyZXN0YXJ0aW5nIHRoZSBkZWxheSB3aW5kb3cuCgojIEVycm9ycwoqIFtgV2FsbGV0RXJyb3I6OlVuYXV0aG9yaXplZGBdIOKAlCBjYWxsZXIgaXMgbm90IGEgY3VycmVudGx5CnJlZ2lzdGVyZWQgZ3VhcmRpYW4uIEFkZGVkIGZvciBjb25zaXN0ZW5jeSB3aXRoCmBpbml0aWF0ZV9yZWNvdmVyeWAvYGFwcHJvdmVfcmVjb3ZlcnlgLCB3aGljaCBib3RoIGFscmVhZHkgZ2F0ZSBvbgpgcmVxdWlyZV9ndWFyZGlhbmA7IHRoaXMgZnVuY3Rpb24gd2FzIHRoZSBvbmUgZXhjZXB0aW9uIHRvIHRoYXQKcGF0dGVybiAoc2VlIGlzc3VlICMyNikg4oCUIGhhcm1sZXNzIG9uIGl0cyBvd24gc2luY2UgcmV2b2tpbmcgb25seQpldmVyICpyZW1vdmVzKiBhbiBhcHByb3ZhbCwgYnV0IGxlYXZpbmcgaXQgdW5jaGVja2VkIG1lYW50IGd1YXJkaWFuCm1lbWJlcnNoaXAgd2Fzbid0IGVuZm9yY2VkIGNvbnNpc3RlbnRseSBhY3Jvc3MgdGhlIHdob2xlIGFwcHJvdmFsCmxpZmVjeWNsZS4AAAAYcmV2b2tlX3JlY292ZXJ5X2FwcHJvdmFsAAAAAQAAAAAAAAAIZ3VhcmRpYW4AAAATAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAALV2FsbGV0RXJyb3IA",
        "AAAAAQAABABQYXlsb2FkIG9mIHRoZSBgcmVjb3ZlcnlfY29tcGxldGVkYCBldmVudCBgZXhlY3V0ZV9yZWNvdmVyeWAgcHVibGlzaGVzCihzZWUgaXNzdWUgIzkxKS4gRXZlcnkgb3RoZXIgZXZlbnQgaW4gdGhpcyBjb250cmFjdCBpcyBhIHJhdyB0dXBsZSDigJQKdGhpcyBvbmUgaXMgZGVsaWJlcmF0ZWx5IGEgbmFtZWQgYCNbY29udHJhY3R0eXBlXWAgc3RydWN0IGluc3RlYWQsIGFuZAp0aGF0J3MgYSBvbmUtb2ZmIGRlcGFydHVyZSB3b3J0aCBleHBsYWluaW5nIHJhdGhlciB0aGFuIGEgc3R5bGlzdGljCmFjY2lkZW50OiBhIHR1cGxlJ3MgZmllbGRzIGFyZSBwb3NpdGlvbmFsIGFuZCB1bmRvY3VtZW50ZWQgaW4gdGhlCm9uLWNoYWluIFhEUiBpdHNlbGYsIHdoaWNoIGlzIGEgdG9sZXJhYmxlIGVyZ29ub21pY3MgdHJhZGUtb2ZmIGZvciBhCjItMyBmaWVsZCBwYXlsb2FkIHdoZXJlIG9yZGVyIGlzIG9idmlvdXMgZnJvbSBjb250ZXh0LiBUaGlzIGV2ZW50IGhhcwpmaXZlIGZpZWxkcyBmZWVkaW5nIGEgc2VjdXJpdHktYWxlcnRpbmcgaW50ZWdyYXRpb24sIHdoZXJlIGEKdHJhbnNwb3NlZCBwYWlyIG9mIGBBZGRyZXNzYGVzIChlLmcuIGFuIGluZGV4ZXIgcmVhZGluZyBgbmV3X2FkbWluYAp3aGVyZSBgb2xkX2FkbWluYCBiZWxvbmdzKSBoYXMgcmVhbCBjb25zZXF1ZW5jZXMg4oCUIGl0IHdvdWxkIG1pc3JlcG9ydAoqd2hvIGp1c3QgbG9zdCBjb250cm9sIG9mIGEgd2FsbGV0KiBkdXJpbmcgZXhhY3RseSB0aGUgaW5jaWRlbnQgdGhhdAptb3N0IG5lZWRzIHRvIGJlIHJlcG9ydGVkIGNvcnJlY3RseS4gQSBuYW1lZCBzdHJ1Y3QgbWFrZXMgZXZlcnkgZmllbGQKc2VsZi1kZXNjcmliaW5nIGluIHRoZSBYRFIsIGluZGVwZW5kZW50IG9mIGFueSBvZmYtY2hhaW4gc2NoZW1hIHRoZQpyZWFkZXIgaGFzIHRvIGFscmVhZHkga25vdyBhbmQga2VlcCBpbiBzeW5jIGJ5IGhhbmQuIFRoZSBjb3N0IGlzCmluY29uc2lzdGVuY3kgd2l0aCB0aGlzIGNvbnRyYWN0J3MgZXhpc3RpbmcgdHVwbGUtZXZlbnQgY29udmVudGlvAAAAAAAAABZSZWNvdmVyeUNvbXBsZXRlZEV2ZW50AAAAAAAGAAABZUV2ZXJ5IGd1YXJkaWFuIHdob3NlIGFwcHJvdmFsIGlzIG9uIHRoZSBleGVjdXRlZCBwcm9wb3NhbCDigJQgbm90Cmp1c3QgdGhlIGB0aHJlc2hvbGRgIG1pbmltdW0uIEEgcmVjb3ZlcnkgcmF0aWZpZWQgNS1vZi01IGFuZCBvbmUKcmF0aWZpZWQgMy1vZi01ICh3aXRoIGB0aHJlc2hvbGQgPT0gM2ApIGFyZSBkaWZmZXJlbnQtcmlzayBldmVudHMKZXZlbiB0aG91Z2ggYm90aCBzYXRpc2Z5IHRoZSBzYW1lIG9uLWNoYWluIHF1b3J1bSBjaGVjazsgYW4KYWxlcnRpbmcgaW50ZWdyYXRpb24gdGhhdCBvbmx5IGtub3dzICJxdW9ydW0gd2FzIHJlYWNoZWQiIGNhbid0CnRlbGwgdGhlbSBhcGFydCwgdGhpcyBmaWVsZCBsZXRzIGl0LgAAAAAAABNhcHByb3ZpbmdfZ3VhcmRpYW5zAAAAA+oAAAATAAABQExlZGdlciBzZXF1ZW5jZSBvZiB0aGUgYGV4ZWN1dGVfcmVjb3ZlcnlgIGNhbGwgaXRzZWxmLiBDb21wYXJpbmcKdGhpcyBhZ2FpbnN0IGByZWFkeV9hdGAgdGVsbHMgYW4gb2JzZXJ2ZXIgaG93IHByb21wdGx5IHRoZQpub3ctZXhlY3V0YWJsZSByZWNvdmVyeSB3YXMgYWN0dWFsbHkgY2xhaW1lZCDigJQgYSBsb25nIGdhcCBjYW4gYmUKYXMgbWVhbmluZ2Z1bCB0byBhIG1vbml0b3Jpbmcgc3lzdGVtIGFzIHRoZSByZWNvdmVyeSBpdHNlbGYgKGUuZy4KIndoeSBkaWQgbm9ib2R5IGV4ZWN1dGUgYW4gYXBwcm92ZWQgcmVjb3ZlcnkgZm9yIHRocmVlIGRheXM/IikuAAAAC2V4ZWN1dGVkX2F0AAAAAAQAAAAxQWRtaW4gYWRkcmVzcyB0aGUgZ3VhcmRpYW5zIHJlY292ZXJlZCBjb250cm9sIHRvLgAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAOkFkbWluIGFkZHJlc3MgaW4gY29udHJvbCBpbW1lZGlhdGVseSBiZWZvcmUgdGhpcyByZWNvdmVyeS4AAAAAAAlvbGRfYWRtaW4AAAAAAAATAAAAgkxlZGdlciBzZXF1ZW5jZSBhdCB3aGljaCB0aGUgdGltZWxvY2sgZWxhcHNlZCBhbmQgdGhpcyByZWNvdmVyeQpiZWNhbWUgZXhlY3V0YWJsZSAoYFJlY292ZXJ5UHJvcG9zYWwucmVhZHlfYXRgIGF0IGV4ZWN1dGlvbiB0aW1lKS4AAAAAAAhyZWFkeV9hdAAAAAQAAACsYFJlY292ZXJ5Q29uZmlnLnRocmVzaG9sZGAgaW4gZWZmZWN0IGZvciB0aGlzIGV4ZWN1dGlvbiDigJQgdGhlCm1pbmltdW0gcXVvcnVtIHNpemUsIGZvciBjb21wdXRpbmcgaG93IG11Y2ggYWJvdmUvYmVsb3cgdGhlIGJhcmUKbWluaW11bSBgYXBwcm92aW5nX2d1YXJkaWFuc2AgYWN0dWFsbHkgd2FzLgAAAAl0aHJlc2hvbGQAAAAAAAAE",
        "AAAAAAAAAcJHcmFudCBhIHNwZW5kZXIgYWxsb3dhbmNlIG92ZXIgdGhlIGNhbGxlcidzIHRva2Vucy4KCioqT3ZlcndyaXRlIHNlbWFudGljczoqKiBjYWxsaW5nIGBhcHByb3ZlYCBmb3IgYW4gZXhpc3RpbmcKYChvd25lciwgc3BlbmRlcilgIHBhaXIgKipyZXBsYWNlcyoqIHRoZSBwcmV2aW91cyBhbGxvd2FuY2UKd2hvbGVzYWxlIOKAlCBpdCBkb2VzICoqbm90KiogYWRkIHRvIHRoZSByZW1haW5pbmcgYmFsYW5jZS4KSWYgYSBzcGVuZGVyIGhhcyBhbHJlYWR5IHVzZWQgcGFydCBvZiB0aGVpciBhbGxvd2FuY2UgYW5kCnRoZSBvd25lciBjYWxscyBgYXBwcm92ZWAgYWdhaW4sIHRoZSBuZXcgYGFtb3VudGAgYmVjb21lcyB0aGUKKnRvdGFsKiBhbGxvd2FuY2UsIG5vdCBhbiBpbmNyZW1lbnQgb24gdG9wIG9mIHdoYXQncyBsZWZ0LgoKYGV4cGlyeV9sZWRnZXJgIG11c3QgYmUgaW4gdGhlIGZ1dHVyZS4AAAAAAAdhcHByb3ZlAAAAAAQAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAADWV4cGlyeV9sZWRnZXIAAAAAAAAEAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAAMV3JhcHBlckVycm9y",
        "AAAAAAAAAC5SZXR1cm4gY3VycmVudCBhbGxvd2FuY2UgZm9yIChvd25lciwgc3BlbmRlcikuAAAAAAAJYWxsb3dhbmNlAAAAAAAAAgAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAdzcGVuZGVyAAAAABMAAAABAAAH0AAAAAlBbGxvd2FuY2UAAAA=",
        "AAAAAQAAAAAAAAAAAAAACUFsbG93YW5jZQAAAAAAAAIAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAANZXhwaXJ5X2xlZGdlcgAAAAAAAAQ=",
        "AAAAAAAAAMhUcmFuc2ZlciB0b2tlbnMgZnJvbSBgZnJvbWAgdG8gYHRvYCB1c2luZyBhIHByZXZpb3VzbHkgZ3JhbnRlZCBhbGxvd2FuY2UuCgpEZWNyZW1lbnRzIHRoZSBhbGxvd2FuY2U7IGZhaWxzIGlmIGV4cGlyZWQgb3IgaW5zdWZmaWNpZW50LgpBbiBhbGxvd2FuY2UgaXMgdXNhYmxlIHRocm91Z2ggYW5kIGluY2x1ZGluZyBpdHMgYGV4cGlyeV9sZWRnZXJgLgAAAA10cmFuc2Zlcl9mcm9tAAAAAAAABQAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAAAAAAh0b2tlbl9pZAAAABMAAAAAAAAABGZyb20AAAATAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAPtAAAAAAAAB9AAAAAMV3JhcHBlckVycm9y",
        "AAAABAAAAAAAAAAAAAAADFdyYXBwZXJFcnJvcgAAAAQAAAAAAAAAEEFsbG93YW5jZUV4cGlyZWQAAAfRAAAAAAAAABVJbnN1ZmZpY2llbnRBbGxvd2FuY2UAAAAAAAfSAAAAAAAAAA1JbnZhbGlkQW1vdW50AAAAAAAH0wAAAAAAAAANSW52YWxpZEV4cGlyeQAAAAAAB9Q=",
        "AAAAAgAAAAAAAAAAAAAADldyYXBwZXJEYXRhS2V5AAAAAAABAAAAAQAAACwob3duZXIsIHNwZW5kZXIpIOKGkiAoYW1vdW50LCBleHBpcnlfbGVkZ2VyKQAAAAlBbGxvd2FuY2UAAAAAAAACAAAAEwAAABM=" ]),
      options
    )
  }
  public readonly fromJSON = {
    send: this.txFromJSON<Result<void>>,
        admin: this.txFromJSON<string>,
        add_asset: this.txFromJSON<Result<void>>,
        guardians: this.txFromJSON<Array<string>>,
        get_assets: this.txFromJSON<Array<AssetInfo>>,
        initialize: this.txFromJSON<Result<void>>,
        accept_admin: this.txFromJSON<Result<void>>,
        add_guardian: this.txFromJSON<Result<void>>,
        record_spend: this.txFromJSON<Result<void>>,
        remove_asset: this.txFromJSON<Result<void>>,
        pending_admin: this.txFromJSON<Option<string>>,
        propose_admin: this.txFromJSON<Result<void>>,
        allowed_tokens: this.txFromJSON<Array<string>>,
        transfer_admin: this.txFromJSON<Result<void>>,
        cancel_recovery: this.txFromJSON<Result<void>>,
        execute_upgrade: this.txFromJSON<Result<void>>,
        get_spend_limit: this.txFromJSON<i128>,
        get_spent_today: this.txFromJSON<i128>,
        pending_upgrade: this.txFromJSON<Option<UpgradeProposal>>,
        propose_upgrade: this.txFromJSON<Result<void>>,
        recovery_config: this.txFromJSON<Option<RecoveryConfig>>,
        remove_guardian: this.txFromJSON<Result<void>>,
        set_spend_limit: this.txFromJSON<Result<void>>,
        approve_recovery: this.txFromJSON<Result<void>>,
        execute_recovery: this.txFromJSON<Result<void>>,
        is_token_allowed: this.txFromJSON<boolean>,
        add_allowed_token: this.txFromJSON<Result<void>>,
        get_token_wrapper: this.txFromJSON<Option<string>>,
        initiate_recovery: this.txFromJSON<Result<void>>,
        recovery_proposal: this.txFromJSON<Option<RecoveryProposal>>,
        set_token_wrapper: this.txFromJSON<Result<void>>,
        get_allowed_tokens: this.txFromJSON<Array<string>>,
        get_spend_allowance: this.txFromJSON<SpendAllowance>,
        migrate_user_assets: this.txFromJSON<Result<u32>>,
        set_recovery_config: this.txFromJSON<Result<void>>,
        remove_allowed_token: this.txFromJSON<Result<void>>,
        cancel_admin_transfer: this.txFromJSON<Result<void>>,
        revoke_recovery_approval: this.txFromJSON<Result<void>>,
        approve: this.txFromJSON<Result<void>>,
        allowance: this.txFromJSON<Allowance>,
        transfer_from: this.txFromJSON<Result<void>>
  }
}