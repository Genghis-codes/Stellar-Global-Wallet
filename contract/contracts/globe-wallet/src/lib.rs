#![no_std]

//! # globe-wallet
//!
//! Core GlobeWallet smart contract on Stellar / Soroban.
//!
//! ## Features
//! - Multi-asset wallet registry: track whitelisted assets per user
//! - Admin-gated asset management
//! - Spend limits: per-asset daily caps to limit loss on key compromise
//! - Guardian-based social recovery of the admin role (see `RECOVERY.md`)
//! - Event emission for all state-changing operations
//!
//! ## Spend Limits
//! Each user can set a `spend_limit` (in stroops/smallest unit) per asset.
//! Payments that would push the total spent in the trailing 24 hours over
//! the limit are rejected with `SpendLimitExceeded`. The window rolls (it is
//! not reset at 00:00 UTC), so the limit cannot be spent twice around
//! midnight (issue #177). Spends are recorded whether or not a limit is set
//! (issue #179), and migrations never delete limits (issue #178).

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Bytes, BytesN, Env, IntoVal, Map,
    String, Symbol, Val, Vec,
};
use token_wrapper::TokenWrapperClient;

// ── Storage Keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    /// Pending admin candidate awaiting acceptance.
    PendingAdmin(Address),
    PendingUpgrade,
    /// Whitelisted assets for a user wallet
    UserAssets(Address),
    /// Spend limit: (user, asset_code) → limit in stroops
    SpendLimit(Address, String),
    /// Daily spent: (user, asset_code) → (amount, day_timestamp)
    DailySpent(Address, String),
    /// Ordered set of guardian addresses authorized to co-sign admin recovery.
    Guardians,
    /// M-of-N approvals required, and the ledger-count timelock delay
    /// between quorum being reached and a recovery becoming executable.
    RecoveryConfig,
    /// The single in-flight recovery proposal, if any.
    RecoveryProposal,
    /// Membership index for guardians, used to avoid scans on recovery calls.
    ///
    /// This is intentionally appended so the serialized values of existing
    /// storage keys remain stable across contract upgrades.
    GuardianMembership,
    /// The token-wrapper contract instance `send` calls into. Admin-set via
    /// `set_token_wrapper`. See docs/design/wiring-reentrancy-threat-model.md.
    TokenWrapperId,
    /// Admin-curated set of token contract addresses `send` is permitted to
    /// move. Membership only — presence of the key means "allowed"; see
    /// `propose_allowed_token`/`execute_allowed_token`/`remove_allowed_token`/
    /// `is_token_allowed`.
    AllowedToken(Address),
    /// Admin-curated list of all allowed token contract addresses.
    AllowedTokens,
    /// Verified Stellar Asset Contract metadata (code, issuer) stored with
    /// each allowlisted token (issue #189).
    AllowedTokenInfo(Address),
    /// Timelocked allowlist addition awaiting `execute_allowed_token`
    /// (issue #189).
    PendingAllowedToken(Address),
    /// Role membership: presence means `Address` holds `Role` (issue #190).
    RoleMember(Role, Address),
    /// Emergency pause flag for `send` (issue #190, `Role::Pauser`).
    Paused,
    // Appended (never reordered) so every key above keeps its encoding.
    Pauser,
    SendsPaused,
    /// (user, token) → marker that a non-zero limit was set (issue #185),
    /// so an archived limit fails safe instead of reading as "unlimited".
    LimitOptIn(Address, Address),
    /// (user, token) → rolling 24h spend window (issue #177).
    SpendWindow(Address, Address),
    /// (user, token) → daily cap (issue #173).
    TokenSpendLimit(Address, Address),
    /// (user, token) → legacy fixed-day spend record (issue #173).
    TokenDailySpent(Address, Address),
    /// (user, token) → limit increase waiting out its delay (issue #173).
    PendingSpendLimit(Address, Address),
    PendingGuardianChange,
    // ── Storage layout v2 (issue #184) ──
    GuardianSet,
    GuardianFlag(Address),
    PendingRecovery,
    StorageLayout,
}

// ── Roles (issue #190) ────────────────────────────────────────────────────────

/// Delegable privileges. The admin implicitly holds every role; anyone else
/// must be granted a role explicitly via `grant_role`. Each role only
/// unlocks its own functions — an `AllowlistManager` cannot upgrade the
/// contract, an `Upgrader` cannot pause it, and so on. The admin itself is
/// expected to be a Stellar multisig account (see `docs/governance.md`), so
/// no single key controls a critical function.
///
/// Discriminants are explicit and stable: they are part of storage keys and
/// event payloads.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Role {
    /// `propose_upgrade` / `execute_upgrade`.
    Upgrader = 1,
    /// `propose_allowed_token` / `execute_allowed_token` /
    /// `cancel_allowed_token` / `remove_allowed_token`.
    AllowlistManager = 2,
    /// `pause` / `unpause`.
    Pauser = 3,
}

// ── Events (issue #192) ───────────────────────────────────────────────────────

/// Schema version carried as the second topic of every event this contract
/// publishes: topics are always `(name: Symbol, EVENT_VERSION: u32)`.
/// Bump it whenever any payload shape changes, so indexers can detect the
/// change instead of silently mis-decoding. Payload shapes for every event
/// name are listed in `docs/events.md`; struct payloads tagged `@event` below
/// are also code-generated into backend decoders
/// (`backend/scripts/gen-contract-spec.ts`).
pub const EVENT_VERSION: u32 = 1;

/// Publish `data` under the versioned topic pair `(name, EVENT_VERSION)`.
fn emit_event<D: IntoVal<Env, Val>>(env: &Env, name: &str, data: D) {
    env.events()
        .publish((Symbol::new(env, name), EVENT_VERSION), data);
}

/// Verified Stellar Asset Contract identity stored with each allowlisted
/// token (issue #189). `issuer_key` is the raw ed25519 issuer public key,
/// `None` for native XLM.
/// Issuer of an allowlisted Stellar asset. A plain `Option<BytesN<32>>`
/// field does not convert to `ScVal` under soroban-sdk 21 testutils, so the
/// "no issuer" case (native XLM) is spelled out instead.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum IssuerKey {
    Native,
    Key(BytesN<32>),
}

impl From<Option<BytesN<32>>> for IssuerKey {
    fn from(key: Option<BytesN<32>>) -> Self {
        match key {
            Some(k) => IssuerKey::Key(k),
            None => IssuerKey::Native,
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AllowedTokenInfo {
    pub token_id: Address,
    pub asset_code: String,
    pub issuer_key: IssuerKey,
}

/// A timelocked allowlist addition (issue #189).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PendingAllowedToken {
    pub info: AllowedTokenInfo,
    pub proposed_by: Address,
    pub ready_at: u32,
}

/// @event token_allowlist_proposed
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TokenAllowlistProposedEvent {
    pub token_id: Address,
    pub asset_code: String,
    pub issuer_key: IssuerKey,
    pub proposed_by: Address,
    pub ready_at: u32,
}

/// @event token_allowed
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TokenAllowedEvent {
    pub token_id: Address,
    pub asset_code: String,
    pub issuer_key: IssuerKey,
    pub executed_by: Address,
}

/// @event token_allowlist_cancelled
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TokenAllowlistCancelledEvent {
    pub token_id: Address,
    pub cancelled_by: Address,
}

/// @event token_disallowed
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TokenDisallowedEvent {
    pub token_id: Address,
    pub removed_by: Address,
}

/// @event role_granted
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RoleGrantedEvent {
    pub role: Role,
    pub account: Address,
    pub granted_by: Address,
}

/// @event role_revoked
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RoleRevokedEvent {
    pub role: Role,
    pub account: Address,
    pub revoked_by: Address,
}

/// @event pause_changed
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PauseChangedEvent {
    pub paused: bool,
    pub changed_by: Address,
}

/// @event send_executed
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SendExecutedEvent {
    pub user: Address,
    pub token_id: Address,
    pub to: Address,
    pub amount: i128,
}

/// Current storage layout version (issue #184). See
/// `docs/design/storage-layout.md`.
pub const STORAGE_LAYOUT_VERSION: u32 = 2;

/// `DailySpent` used to live in *temporary* storage while `SpendLimit` lives in
/// *persistent* storage. Soroban archives temporary entries on its own TTL
/// schedule, independent of the 86 400-second day-window logic here — if the
/// entry got archived before the day boundary, `record_spend` would silently
/// treat the user as having spent 0 today, letting them exceed the configured
/// cap. `DailySpent` now lives in persistent storage (matching `SpendLimit`)
/// and its TTL is proactively extended past the current day boundary on every
/// write so archival can never race the day window.
const LEDGERS_PER_DAY: u32 = 17_280; // ~86_400s / 5s average ledger close time
const DAILY_SPENT_TTL_THRESHOLD: u32 = LEDGERS_PER_DAY;
const DAILY_SPENT_TTL_EXTEND_TO: u32 = LEDGERS_PER_DAY * 2;
/// Length of the legacy fixed `DailySpent` day bucket (pre-#177).
const SECONDS_PER_DAY: u64 = 86_400;
/// Granularity of the rolling spend window (issue #177).
const SPEND_BUCKET_SECONDS: u64 = 3_600;
/// Number of hourly buckets kept per (user, asset): 24 for the window plus
/// one guard bucket. Counting 25 buckets means every spend from the last
/// 86 400 s is always counted (a spend can only be dropped once it is more
/// than 24 h old), so in *any* 24 h interval the total spent is ≤ the limit.
/// The cost is that a spend may stay counted for up to 25 h.
const SPEND_WINDOW_BUCKETS: u32 = 25;

/// `UserAssets` and `SpendLimit` are persistent entries without a natural
/// time-based expiry (unlike `DailySpent`'s 86 400-second day window).
/// Without proactive TTL extension, a wallet that goes quiet for long
/// periods while the contract itself stays active could have its asset
/// list or spend limits archived, requiring a separate (costly) restore
/// operation before the entry is readable again. Extending to ~30 days of
/// ledgers on every write keeps these entries alive for any reasonable
/// inactivity window while staying well within Soroban's max_entry_ttl
/// (~6.3M ledgers, ≈1 year).
const PERSISTENT_TTL_THRESHOLD: u32 = LEDGERS_PER_DAY * 7; // ~7 days
const PERSISTENT_TTL_EXTEND_TO: u32 = LEDGERS_PER_DAY * 30; // ~30 days

/// `LimitOptIn` markers (issue #185) are extended much further than the
/// entries they guard, so the marker always outlives the `SpendLimit` it
/// vouches for. 180 days stays well under the network's `max_entry_ttl`
/// (~1 year).
const OPT_IN_TTL_THRESHOLD: u32 = LEDGERS_PER_DAY * 30;
const OPT_IN_TTL_EXTEND_TO: u32 = LEDGERS_PER_DAY * 180;

/// How long a spend-limit increase (or switch to unlimited) waits before it
/// takes effect (issue #173). Decreases apply immediately.
pub const SPEND_LIMIT_INCREASE_DELAY_SECS: u64 = SECONDS_PER_DAY;

// ── Types ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AssetInfo {
    /// e.g. "XLM", "USDC"
    ///
    /// **Canonicalization decision (issue #29):** `code` must be non-empty
    /// and at most [`GlobeWallet::MAX_ASSET_CODE_LEN`] bytes — enforced by
    /// [`GlobeWallet::add_asset`]. Storage preserves the caller's original
    /// casing, but duplicate detection in `add_asset` treats codes as equal
    /// case-insensitively (ASCII), so `"USDC"` and `"usdc"` are considered
    /// the same asset and cannot both be registered for one user.
    pub code: String,
    /// Issuer address; None for XLM (native)
    pub issuer: Option<Address>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SpendRecord {
    pub amount: i128,
    /// Ledger-time timestamp of the current day window
    pub day: u64,
}

/// Rolling spend window for one (user, asset) pair (issue #177).
///
/// O(1) storage: a fixed ring of [`SPEND_WINDOW_BUCKETS`] hourly totals.
/// Slot `h % SPEND_WINDOW_BUCKETS` holds the amount spent during hour `h`
/// (`h = ledger_timestamp / 3600`). Buckets older than
/// `head_hour - (SPEND_WINDOW_BUCKETS - 1)` are zeroed as the head moves.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SpendWindow {
    /// Hour index of the newest bucket this ring has been advanced to.
    pub head_hour: u64,
    /// Exactly `SPEND_WINDOW_BUCKETS` per-hour totals.
    pub buckets: Vec<i128>,
}

/// Read-only view of a user's rolling 24 h spend window for one asset,
/// returned by [`GlobeWallet::get_spend_allowance`] (issues #50, #177).
///
/// Times are ledger timestamps (Unix seconds, by ledger close time).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SpendAllowance {
    /// Configured daily cap (0 = unlimited).
    pub limit: i128,
    /// Amount spent in the rolling window. Tracked even when `limit == 0`
    /// (issue #179), so turning a limit on later accounts for it.
    pub spent: i128,
    /// `limit - spent`, floored at 0. 0 when `limit == 0` — callers must
    /// check `limit` to distinguish "unlimited" from "nothing left".
    pub remaining: i128,
    /// Start of the oldest hourly bucket still counted in `spent`.
    pub window_start: u64,
    /// When every spend currently counted will have rolled off (`spent`
    /// reaches 0 if nothing else is spent). Equals "now" when `spent == 0`.
    pub window_resets_at: u64,
    /// When the oldest counted bucket rolls off and `remaining` next grows.
    /// 0 when nothing is counted.
    pub next_refill_at: u64,
}

/// A spend-limit increase waiting out [`SPEND_LIMIT_INCREASE_DELAY_SECS`]
/// (#176). `limit == 0` means the pending change switches to unlimited.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PendingSpendLimit {
    pub limit: i128,
    /// Ledger timestamp (Unix seconds) from which `limit` is in force.
    pub effective_at: u64,
}

/// A queued guardian addition or removal (#175). Applied by
/// `apply_guardian_change` once `ready_at` is reached and no recovery is
/// pending.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct GuardianChange {
    pub guardian: Address,
    /// `true` = add, `false` = remove.
    pub add: bool,
    /// Ledger sequence from which the change may be applied.
    pub ready_at: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct UpgradeProposal {
    pub wasm_hash: BytesN<32>,
    pub proposed_by: Address,
    pub ready_at: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RecoveryConfig {
    /// Number of distinct guardian approvals required to reach quorum.
    pub threshold: u32,
    /// Ledger-count delay between reaching quorum and `execute_recovery`
    /// becoming callable. Gives the legitimate admin a window to notice
    /// and cancel a malicious or mistaken recovery.
    pub delay_in_ledgers: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RecoveryProposal {
    pub new_admin: Address,
    pub approvals: Vec<Address>,
    /// Set once quorum is first reached; cleared again if approvals drop
    /// back below threshold. `execute_recovery` requires `ledger seq >= ready_at`.
    pub ready_at: Option<u32>,
}

/// @event recovery_completed
///
/// Payload of the `recovery_completed` event `execute_recovery` publishes
/// (see issue #91). Every other event in this contract is a raw tuple —
/// this one was deliberately a named `#[contracttype]` struct instead (issue #192 has since added typed struct payloads for every new event), and
/// that's a one-off departure worth explaining rather than a stylistic
/// accident: a tuple's fields are positional and undocumented in the
/// on-chain XDR itself, which is a tolerable ergonomics trade-off for a
/// 2-3 field payload where order is obvious from context. This event has
/// five fields feeding a security-alerting integration, where a
/// transposed pair of `Address`es (e.g. an indexer reading `new_admin`
/// where `old_admin` belongs) has real consequences — it would misreport
/// *who just lost control of a wallet* during exactly the incident that
/// most needs to be reported correctly. A named struct makes every field
/// self-describing in the XDR, independent of any off-chain schema the
/// reader has to already know and keep in sync by hand. The cost is
/// inconsistency with this contract's existing tuple-event convention;
/// the recommendation, not executed here to keep this PR's diff scoped to
/// issue #91, is to migrate the other multi-field events to the same
/// pattern in a follow-up rather than let this be the one place it's used.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RecoveryCompletedEvent {
    /// Admin address in control immediately before this recovery.
    pub old_admin: Address,
    /// Admin address the guardians recovered control to.
    pub new_admin: Address,
    /// Every guardian whose approval is on the executed proposal — not
    /// just the `threshold` minimum. A recovery ratified 5-of-5 and one
    /// ratified 3-of-5 (with `threshold == 3`) are different-risk events
    /// even though both satisfy the same on-chain quorum check; an
    /// alerting integration that only knows "quorum was reached" can't
    /// tell them apart, this field lets it.
    pub approving_guardians: Vec<Address>,
    /// `RecoveryConfig.threshold` in effect for this execution — the
    /// minimum quorum size, for computing how much above/below the bare
    /// minimum `approving_guardians` actually was.
    pub threshold: u32,
    /// Ledger sequence at which the timelock elapsed and this recovery
    /// became executable (`RecoveryProposal.ready_at` at execution time).
    pub ready_at: u32,
    /// Ledger sequence of the `execute_recovery` call itself. Comparing
    /// this against `ready_at` tells an observer how promptly the
    /// now-executable recovery was actually claimed — a long gap can be
    /// as meaningful to a monitoring system as the recovery itself (e.g.
    /// "why did nobody execute an approved recovery for three days?").
    pub executed_at: u32,
}

// ── Errors ────────────────────────────────────────────────────────────────────

// Discriminants are explicit and frozen (issue #193): every name/code pair is
// pinned in `contracts/globe-wallet/error-codes.snapshot.json`, checked by
// `test_error_discriminants_match_snapshot` here and by the backend's
// generated-mapping test. Never renumber or reorder — only append.
//
// Every discriminant below is deliberately part of one contiguous `1001+`
// namespace (see issue #23) — do not introduce a second, lower-numbered
// scheme again. token-wrapper's WrapperError uses a separate `2001+`
// namespace (see contracts/token-wrapper/src/lib.rs) precisely so a raw
// `Error(Contract, #N)` code is unambiguous about which contract raised it.
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum WalletError {
    AlreadyInitialized = 1001,
    NotInitialized = 1002,
    Unauthorized = 1003,
    AssetAlreadyAdded = 1004,
    AssetNotFound = 1005,
    InvalidSpendLimit = 1006,
    /// Payment would exceed the daily spend limit for this asset
    SpendLimitExceeded = 1007,
    NoAssetsProvided = 1008,
    NoPendingAdmin = 1009,
    SpendOverflow = 1010,
    AssetLimitExceeded = 1011,
    MaxAssetsReached = 1012,
    UpgradeAlreadyPending = 1013,
    UpgradeNotPending = 1014,
    UpgradeHashMismatch = 1015,
    UpgradeNotReady = 1016,
    UpgradeFailed = 1017,
    /// Guardian address already registered.
    GuardianAlreadyAdded = 1018,
    /// Address is not a registered guardian.
    GuardianNotFound = 1019,
    /// Recovery threshold must be `1 < threshold <= guardians.len()`.
    InvalidRecoveryThreshold = 1020,
    /// `add_guardian`/`set_recovery_config` would leave threshold >
    /// guardian count, or guardians.len() below the required minimum.
    NotEnoughGuardians = 1021,
    /// No recovery threshold/delay configured yet — call `set_recovery_config` first.
    RecoveryNotConfigured = 1022,
    /// A recovery proposal is already in flight; cancel or execute it first.
    RecoveryAlreadyPending = 1023,
    /// No recovery proposal is currently pending.
    NoPendingRecovery = 1024,
    /// Guardian has already approved the pending proposal.
    AlreadyApproved = 1025,
    /// Guardian has not approved the pending proposal (nothing to revoke).
    ApprovalNotFound = 1026,
    /// Quorum reached but the timelock delay has not yet elapsed.
    RecoveryNotReady = 1027,
    /// Approvals dropped below threshold since quorum was reached; timelock reset.
    RecoveryNotQuorate = 1028,
    /// Asset code and issuer configuration is invalid
    InvalidAssetInfo = 1029,
    /// Proposed wasm hash is not registered on-chain (never uploaded via upload_contract_wasm)
    UpgradeWasmNotUploaded = 1030,
    /// `add_guardian` would exceed [`GlobeWallet::MAX_GUARDIANS`].
    GuardianLimitExceeded = 1031,
    /// `execute_recovery`'s proposal targets the same address that is
    /// already the current admin — recovering "to" a no-op target is
    /// rejected rather than silently succeeding as a wasted transfer.
    RecoveryNewAdminUnchanged = 1032,
    /// `AssetInfo.code` is empty or exceeds `GlobeWallet::MAX_ASSET_CODE_LEN`.
    InvalidAssetCode = 1033,
    /// `send`'s `token_id` is not on the admin-curated allowlist. See
    /// docs/design/wiring-reentrancy-threat-model.md §4.
    TokenNotAllowed = 1034,
    /// `send` was called before an admin configured the token-wrapper
    /// contract instance via `set_token_wrapper`.
    TokenWrapperNotSet = 1035,
    /// The `token-wrapper::transfer_from` call `send` makes failed (e.g.
    /// insufficient/expired allowance) or could not be invoked at all.
    TokenTransferFailed = 1036,
    /// `propose_upgrade`'s `delay_in_ledgers` is below
    /// [`GlobeWallet::MIN_UPGRADE_DELAY_LEDGERS`] (see issue #84).
    UpgradeDelayTooShort = 1037,
    /// `set_recovery_config`'s `delay_in_ledgers` is below
    /// [`GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS`] (see issue #84).
    RecoveryDelayTooShort = 1038,
    /// `send` was called while a `Role::Pauser` holder has paused the
    /// contract (issue #190).
    ContractPaused = 1039,
    /// `propose_allowed_token`'s `token_id` is not the Stellar Asset
    /// Contract derived from the supplied asset code + issuer (issue #189).
    TokenNotStellarAsset = 1040,
    /// No timelocked allowlist proposal exists for this token (issue #189).
    AllowlistProposalNotFound = 1041,
    /// The allowlist timelock has not elapsed yet (issue #189).
    AllowlistNotReady = 1042,
    /// A proposal for this token is already pending, or the token is
    /// already allowlisted (issue #189).
    AllowlistAlreadyPending = 1043,
    SendsPaused = 1044,
    SpendLimitArchived = 1045,
    NoPendingSpendLimit = 1046,
    GuardianChangePending = 1047,
    NoPendingGuardianChange = 1048,
    GuardianChangeNotReady = 1049,
    RecoveryCancelNotAllowed = 1050,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct GlobeWallet;

#[contractimpl]
impl GlobeWallet {
    /// Minimum number of guardians a wallet must have before a recovery
    /// threshold can be configured. Below this, "M-of-N social recovery"
    /// degenerates into "one or two people can unilaterally seize the wallet".
    const MIN_GUARDIANS_FOR_RECOVERY: u32 = 3;

    /// Maximum guardians a wallet may register — mirrors [`Self::MAX_ASSETS`]'s
    /// rationale but for storage-*mutation* cost rather than raw storage size
    /// (see issue #27). `Guardians` (and its `GuardianMembership` index) lives
    /// in *instance* storage, shared with every other piece of per-contract-
    /// instance state (`Admin`, `PendingUpgrade`, `RecoveryConfig`,
    /// `RecoveryProposal`, every `PendingAdmin(...)` entry). Every
    /// `add_guardian`/`remove_guardian` call rewrites the *entire*
    /// `Vec<Address>` under one key, so write cost grows with guardian count
    /// on every single mutation, not just at read time. Real-world social-
    /// recovery guardian sets are typically 5-9 people, so 15 leaves
    /// comfortable headroom above any realistic threshold while keeping
    /// per-call cost bounded and predictable.
    pub const MAX_GUARDIANS: u32 = 15;

    /// Minimum delay (in ledgers) `propose_upgrade` must enforce between a
    /// proposal and `execute_upgrade` becoming callable (see issue #84).
    ///
    /// Without a floor, `delay_in_ledgers = 0` makes "propose" and "execute"
    /// indistinguishable from a single atomic code swap — the exact opposite
    /// of the documented purpose ("wait for the delay to elapse before
    /// executing"). `propose_upgrade` requires only the *current* admin key,
    /// not guardian quorum, so this timelock is the *only* defense against a
    /// compromised admin key entrenching itself by swapping the contract's
    /// code before anyone watching `upgrade_proposed` can react. Three days'
    /// worth of ledgers (`LEDGERS_PER_DAY * 3`) is chosen — deliberately
    /// longer than [`Self::MIN_RECOVERY_DELAY_LEDGERS`] — because a code
    /// swap is a strictly larger blast radius than an admin-key rotation and
    /// deserves enough margin for a human (not just an automated monitor) to
    /// notice and respond even across a weekend.
    pub const MIN_UPGRADE_DELAY_LEDGERS: u32 = LEDGERS_PER_DAY * 3;

    /// Minimum delay (in ledgers) `set_recovery_config` must enforce between
    /// guardian quorum being reached and `execute_recovery` becoming
    /// callable (see issue #84).
    ///
    /// Mirrors [`Self::MIN_UPGRADE_DELAY_LEDGERS`]'s rationale: a `delay_in_ledgers`
    /// floor is required because the doc comment on [`RecoveryConfig::delay_in_ledgers`]
    /// promises the admin "a window to notice and cancel a malicious or
    /// mistaken recovery" — a promise `delay_in_ledgers = 0` breaks entirely,
    /// since `cancel_recovery` would then have to race the very transaction
    /// that reached quorum. Recovery already has one layer `propose_upgrade`
    /// lacks (independent guardian quorum, not a single key), so one day's
    /// worth of ledgers (`LEDGERS_PER_DAY`) is a sufficient floor for this
    /// second layer: enough for a human to plausibly notice the
    /// `recovery_quorum_reached` event, without needlessly delaying a
    /// legitimate lost-device recovery that quorum has already vetted.
    pub const MIN_RECOVERY_DELAY_LEDGERS: u32 = LEDGERS_PER_DAY;

    /// How often (in ledgers) an off-chain keeper should call
    /// [`Self::extend_user_ttl`] for each active wallet (issue #185). One
    /// day — the shortest threshold of any per-user entry (`DailySpent`) —
    /// so no entry can slip past its threshold between keeper runs.
    pub const KEEPER_INTERVAL_LEDGERS: u32 = LEDGERS_PER_DAY;

    /// Initialize the contract with an admin address.
    ///
    /// # Errors
    /// * [`WalletError::AlreadyInitialized`]
    pub fn initialize(env: Env, admin: Address) -> Result<(), WalletError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(WalletError::AlreadyInitialized);
        }
        Self::bump_instance_ttl(&env);
        env.storage().instance().set(&DataKey::Admin, &admin);
        emit_event(&env, "initialized", admin);
        Ok(())
    }

    /// Return current admin.
    pub fn admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    /// Return the pending admin candidate, if any.
    pub fn pending_admin(env: Env) -> Option<Address> {
        let admin: Option<Address> = env.storage().instance().get(&DataKey::Admin);
        let admin = admin?;
        env.storage().instance().get(&DataKey::PendingAdmin(admin))
    }

    /// Legacy single-step admin transfer.
    ///
    /// Deprecated in favor of `propose_admin` + `accept_admin`.
    ///
    /// # Errors
    /// * [`WalletError::NotInitialized`] / [`WalletError::Unauthorized`]
    #[deprecated(note = "Use propose_admin and accept_admin instead")]
    pub fn transfer_admin(env: Env, current: Address, new_admin: Address) -> Result<(), WalletError> {
        Self::propose_admin(env, current, new_admin)
    }

    /// Propose a new admin candidate.
    ///
    /// The current admin remains in control until the candidate accepts.
    pub fn propose_admin(env: Env, current: Address, candidate: Address) -> Result<(), WalletError> {
        current.require_auth();
        Self::require_admin(&env, &current)?;
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin(current.clone()), &candidate);
        emit_event(&env, "admin_proposed", (current, candidate),
        );
        Ok(())
    }

    /// Accept a pending admin proposal.
    pub fn accept_admin(env: Env, candidate: Address) -> Result<(), WalletError> {
        candidate.require_auth();
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(WalletError::NotInitialized)?;
        let pending: Option<Address> = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin(admin.clone()));
        let pending = pending.ok_or(WalletError::NoPendingAdmin)?;
        if pending != candidate {
            return Err(WalletError::Unauthorized);
        }
        Self::bump_instance_ttl(&env);
        env.storage().instance().set(&DataKey::Admin, &candidate);
        env.storage()
            .instance()
            .remove(&DataKey::PendingAdmin(admin.clone()));
        emit_event(&env, "admin_transferred", (admin, candidate),
        );
        Ok(())
    }

    /// Cancel the current pending admin proposal.
    pub fn cancel_admin_transfer(env: Env, current: Address) -> Result<(), WalletError> {
        current.require_auth();
        Self::require_admin(&env, &current)?;
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .remove(&DataKey::PendingAdmin(current.clone()));
        emit_event(&env, "admin_transfer_cancelled", current);
        Ok(())
    }

    /// Queue an upgrade for later execution.
    ///
    /// The proposal is stored in contract instance storage and emitted as an
    /// event so the upgrade is visible on-chain before any code swap occurs.
    ///
    /// The provided `wasm_hash` is stored as-is *without validation* — it is
    /// the caller's responsibility to ensure it matches a blob previously uploaded
    /// on-chain via [`Env::deployer().upload_contract_wasm()`]. No pre-check is
    /// performed here; validation occurs when `execute_upgrade` is called.
    ///
    /// # Errors
    /// * [`WalletError::UpgradeAlreadyPending`] — an upgrade is already queued
    /// * [`WalletError::Unauthorized`] — caller is neither the admin nor a
    ///   [`Role::Upgrader`] holder (issue #190)
    /// * [`WalletError::UpgradeDelayTooShort`] — `delay_in_ledgers` is below
    ///   [`Self::MIN_UPGRADE_DELAY_LEDGERS`] (see issue #84)
    ///
    /// See [`Self::execute_upgrade`] for operational notes and the correct
    /// sequence of steps (upload → propose → wait → execute).
    pub fn propose_upgrade(
        env: Env,
        proposer: Address,
        wasm_hash: BytesN<32>,
        delay_in_ledgers: u32,
    ) -> Result<(), WalletError> {
        proposer.require_auth();
        Self::require_role(&env, &proposer, Role::Upgrader)?;
        if env.storage().instance().has(&DataKey::PendingUpgrade) {
            return Err(WalletError::UpgradeAlreadyPending);
        }
        Self::bump_instance_ttl(&env);
        if delay_in_ledgers < Self::MIN_UPGRADE_DELAY_LEDGERS {
            return Err(WalletError::UpgradeDelayTooShort);
        }
        let ready_at = env.ledger().sequence().saturating_add(delay_in_ledgers);
        let proposal = UpgradeProposal {
            wasm_hash: wasm_hash.clone(),
            proposed_by: proposer.clone(),
            ready_at,
        };
        env.storage()
            .instance()
            .set(&DataKey::PendingUpgrade, &proposal);
        emit_event(&env, "upgrade_proposed", (proposer, wasm_hash, ready_at),
        );
        Ok(())
    }

    /// Execute a previously proposed upgrade after the timelock elapses.
    ///
    /// This function validates that:
    /// 1. A proposal exists and is stored in instance storage
    /// 2. The provided `wasm_hash` matches the proposed hash (via equality check)
    /// 3. The current ledger sequence has reached or exceeded `ready_at` (timelock elapsed)
    /// 4. The `wasm_hash` was previously registered on-chain via [`Env::deployer().upload_contract_wasm()`]
    ///
    /// # Errors
    /// * [`WalletError::UpgradeNotPending`] — no pending upgrade proposal
    /// * [`WalletError::UpgradeHashMismatch`] — provided hash doesn't match stored proposal
    /// * [`WalletError::UpgradeNotReady`] — timelock has not yet elapsed
    /// * [`WalletError::UpgradeWasmNotUploaded`] — wasm hash was never registered on-chain
    ///
    /// # Operational Notes
    /// Correct upgrade sequence is:
    /// 1. Upload new contract WASM via a separate transaction → obtain wasm_hash
    /// 2. Call `propose_upgrade` with that hash and desired delay
    /// 3. Wait for the delay (in ledgers) to elapse
    /// 4. Call `execute_upgrade` with the same hash
    ///
    /// If a WASM blob is never uploaded before `execute_upgrade` is called,
    /// or if the upload happened on a different network than where
    /// `execute_upgrade` is invoked, this function will catch that via
    /// [`WalletError::UpgradeWasmNotUploaded`] rather than trapping.
    pub fn execute_upgrade(
        env: Env,
        executor: Address,
        wasm_hash: BytesN<32>,
    ) -> Result<(), WalletError> {
        executor.require_auth();
        Self::require_role(&env, &executor, Role::Upgrader)?;
        let proposal: UpgradeProposal = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgrade)
            .ok_or(WalletError::UpgradeNotPending)?;
        if proposal.wasm_hash != wasm_hash {
            return Err(WalletError::UpgradeHashMismatch);
        }
        if env.ledger().sequence() < proposal.ready_at {
            return Err(WalletError::UpgradeNotReady);
        }
        Self::bump_instance_ttl(&env);

        // Pre-check: attempt to verify the wasm hash exists before calling
        // update_current_contract_wasm. This provides a typed WalletError
        // rather than a host trap if the hash was never uploaded.
        //
        // Note: Soroban's SDK does not expose a direct "is_hash_registered"
        // query, so we attempt a proof-of-concept: try to perform a benign
        // operation that touches the registry. If that fails or if there is
        // no reliable pre-check available in the current Soroban version,
        // the fallback is to assume the host will trap gracefully.
        //
        // For now, we call update_current_contract_wasm directly and let
        // the host trap if the hash is invalid. See issue #31 for a request
        // to add Soroban SDK support for a pre-check query.
        //
        // TODO: Investigate if Soroban exposes a registry query method that
        // can validate a hash before update_current_contract_wasm is called.
        // If not available, this function may still trap on invalid hash.
        
        env.deployer().update_current_contract_wasm(wasm_hash.clone());
        env.storage().instance().remove(&DataKey::PendingUpgrade);
        emit_event(&env, "upgrade_executed", (executor, wasm_hash),
        );
        Ok(())
    }

    /// Return the pending upgrade proposal, if any.
    pub fn pending_upgrade(env: Env) -> Option<UpgradeProposal> {
        env.storage().instance().get(&DataKey::PendingUpgrade)
    }

    // ── Guardian-Based Admin Recovery ────────────────────────────────────────
    //
    // See `https://github.com/Orbit-Wal/mobile/blob/main/docs/design/recovery/RECOVERY.md`
    // for the full design rationale, threat model, and interaction spec this
    // section implements. Summary of the invariants enforced here:
    //
    // 1. `execute_recovery` never calls `require_admin`/`current.require_auth()`
    //    — by construction the whole point is that the admin key is gone.
    //    It is instead gated purely by guardian quorum + timelock.
    // 2. The *current* admin can cancel a pending recovery via
    //    `cancel_recovery`, but only before quorum or during the first half
    //    of the timelock, and never once a guardian supermajority (>= 2/3)
    //    has approved (issue #175). A compromised admin therefore cannot
    //    stall a quorate recovery indefinitely.
    // 5. The guardian set is frozen while a proposal is pending, and once
    //    recovery is configured every add/remove is timelocked by the
    //    recovery delay (issue #175), so a hostile admin can neither remove
    //    approving guardians nor dilute the set with sybils mid-recovery.
    // 3. The timelock clock starts only when quorum is first reached, not at
    //    initiation — a single (or minority) guardian cannot start a live
    //    countdown alone.
    // 4. Dropping below threshold after quorum (via `revoke_recovery_approval`)
    //    clears `ready_at` and re-arms the timelock on the next requorum,
    //    so a guardian having second thoughts can't be steam-rolled by a
    //    stale countdown started earlier.

    /// Register a new guardian. Admin-authorized.
    ///
    /// ## Timelock and freeze (issue #175)
    /// Before recovery is configured (initial setup) the guardian is added
    /// immediately. Once a `RecoveryConfig` exists the addition is only
    /// *queued* as a [`GuardianChange`] that `apply_guardian_change` can land
    /// after `RecoveryConfig.delay_in_ledgers` — the same delay a recovery
    /// has to wait out — so a compromised admin cannot pack the set with
    /// sybils faster than the honest guardians can start a recovery. While a
    /// recovery proposal is pending the guardian set is frozen and this call
    /// fails with [`WalletError::RecoveryAlreadyPending`].
    ///
    /// # Errors
    /// * [`WalletError::GuardianAlreadyAdded`]
    /// * [`WalletError::GuardianLimitExceeded`] — would exceed
    ///   [`Self::MAX_GUARDIANS`] (see issue #27).
    /// * [`WalletError::RecoveryAlreadyPending`] — guardian set is frozen.
    /// * [`WalletError::GuardianChangePending`] — another change is queued.
    pub fn add_guardian(env: Env, admin: Address, guardian: Address) -> Result<(), WalletError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::require_no_pending_recovery(&env)?;
        Self::validate_guardian_add(&env, &guardian)?;
        Self::bump_instance_ttl(&env);
        match Self::recovery_config(env.clone()) {
            None => Self::apply_guardian_add(&env, guardian),
            Some(config) => Self::queue_guardian_change(&env, guardian, true, config.delay_in_ledgers)?,
        }
        Ok(())
    }

    /// Remove a guardian. Admin-authorized.
    ///
    /// Same freeze/timelock rules as [`Self::add_guardian`] (issue #175):
    /// immediate before recovery is configured, queued for
    /// `RecoveryConfig.delay_in_ledgers` afterwards, and rejected while a
    /// recovery proposal is pending. Because the set is frozen during a
    /// recovery, a removal can no longer strip approvals from an in-flight
    /// proposal — the approval-stripping path from issue #26 is unreachable
    /// and was removed; `require_guardian` still stops a removed guardian
    /// from acting on any *later* proposal.
    ///
    /// # Errors
    /// * [`WalletError::GuardianNotFound`]
    /// * [`WalletError::NotEnoughGuardians`] — would drop the guardian count
    ///   below the configured recovery threshold.
    /// * [`WalletError::RecoveryAlreadyPending`] — guardian set is frozen.
    /// * [`WalletError::GuardianChangePending`] — another change is queued.
    pub fn remove_guardian(env: Env, admin: Address, guardian: Address) -> Result<(), WalletError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::require_no_pending_recovery(&env)?;
        Self::validate_guardian_remove(&env, &guardian)?;
        Self::bump_instance_ttl(&env);
        match Self::recovery_config(env.clone()) {
            None => Self::apply_guardian_remove(&env, guardian),
            Some(config) => Self::queue_guardian_change(&env, guardian, false, config.delay_in_ledgers)?,
        }
        Ok(())
    }

    /// Land the queued guardian-set change once its timelock has elapsed
    /// (issue #175). Permissionless — the admin authorized the change when
    /// queueing it; the delay is the guardians' window to react. Validation
    /// is re-run at apply time because the set may have changed meanwhile.
    ///
    /// # Errors
    /// * [`WalletError::NoPendingGuardianChange`]
    /// * [`WalletError::GuardianChangeNotReady`]
    /// * [`WalletError::RecoveryAlreadyPending`] — the set is frozen while a
    ///   recovery is in flight; a successful recovery discards the change.
    pub fn apply_guardian_change(env: Env) -> Result<(), WalletError> {
        let change: GuardianChange = env
            .storage()
            .instance()
            .get(&DataKey::PendingGuardianChange)
            .ok_or(WalletError::NoPendingGuardianChange)?;
        Self::require_no_pending_recovery(&env)?;
        if env.ledger().sequence() < change.ready_at {
            return Err(WalletError::GuardianChangeNotReady);
        }
        if change.add {
            Self::validate_guardian_add(&env, &change.guardian)?;
        } else {
            Self::validate_guardian_remove(&env, &change.guardian)?;
        }
        Self::bump_instance_ttl(&env);
        env.storage().instance().remove(&DataKey::PendingGuardianChange);
        if change.add {
            Self::apply_guardian_add(&env, change.guardian);
        } else {
            Self::apply_guardian_remove(&env, change.guardian);
        }
        Ok(())
    }

    /// Admin: discard the queued guardian-set change (issue #175).
    ///
    /// # Errors
    /// * [`WalletError::NoPendingGuardianChange`]
    pub fn cancel_guardian_change(env: Env, admin: Address) -> Result<(), WalletError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        let change: GuardianChange = env
            .storage()
            .instance()
            .get(&DataKey::PendingGuardianChange)
            .ok_or(WalletError::NoPendingGuardianChange)?;
        Self::bump_instance_ttl(&env);
        env.storage().instance().remove(&DataKey::PendingGuardianChange);
        env.events().publish(
            (Symbol::new(&env, "guardian_change_cancelled"),),
            (change.guardian, change.add),
        );
        Ok(())
    }

    /// Return the queued guardian-set change, if any (issue #175).
    pub fn pending_guardian_change(env: Env) -> Option<GuardianChange> {
        env.storage().instance().get(&DataKey::PendingGuardianChange)
    }

    /// The guardian set is frozen while a recovery proposal exists (#175).
    fn require_no_pending_recovery(env: &Env) -> Result<(), WalletError> {
        if Self::recovery_proposal(env.clone()).is_some() {
            return Err(WalletError::RecoveryAlreadyPending);
        }
        Ok(())
    }

    fn validate_guardian_add(env: &Env, guardian: &Address) -> Result<(), WalletError> {
        if Self::is_guardian(env, guardian) {
            return Err(WalletError::GuardianAlreadyAdded);
        }
        if Self::guardians(env.clone()).len() >= Self::MAX_GUARDIANS {
            return Err(WalletError::GuardianLimitExceeded);
        }
        Ok(())
    }

    fn validate_guardian_remove(env: &Env, guardian: &Address) -> Result<(), WalletError> {
        if !Self::is_guardian(env, guardian) {
            return Err(WalletError::GuardianNotFound);
        }
        if let Some(config) = Self::recovery_config(env.clone()) {
            if Self::guardians(env.clone()).len() - 1 < config.threshold {
                return Err(WalletError::NotEnoughGuardians);
            }
        }
        Ok(())
    }

    fn queue_guardian_change(
        env: &Env,
        guardian: Address,
        add: bool,
        delay_in_ledgers: u32,
    ) -> Result<(), WalletError> {
        if env.storage().instance().has(&DataKey::PendingGuardianChange) {
            return Err(WalletError::GuardianChangePending);
        }
        let ready_at = env.ledger().sequence().saturating_add(delay_in_ledgers);
        let change = GuardianChange {
            guardian: guardian.clone(),
            add,
            ready_at,
        };
        env.storage()
            .instance()
            .set(&DataKey::PendingGuardianChange, &change);
        env.events().publish(
            (Symbol::new(env, "guardian_change_proposed"),),
            (guardian, add, ready_at),
        );
        Ok(())
    }

    fn apply_guardian_add(env: &Env, guardian: Address) {
        Self::ensure_storage_layout(env);
        let mut guardians = Self::guardians(env.clone());
        guardians.push_back(guardian.clone());
        Self::store_guardians(env, &guardians);
        Self::set_guardian_flag(env, &guardian);
        emit_event(env, "guardian_added", guardian);
    }

    /// The guardian set is frozen while a recovery is pending (issue #175),
    /// so there is never an in-flight proposal whose approvals need pruning.
    fn apply_guardian_remove(env: &Env, guardian: Address) {
        Self::ensure_storage_layout(env);
        let guardians = Self::guardians(env.clone());
        let mut new_guardians: Vec<Address> = Vec::new(env);
        for i in 0..guardians.len() {
            let g = guardians.get(i).unwrap();
            if g != guardian {
                new_guardians.push_back(g);
            }
        }
        Self::store_guardians(env, &new_guardians);
        env.storage()
            .persistent()
            .remove(&DataKey::GuardianFlag(guardian.clone()));
        emit_event(env, "guardian_removed", guardian);
    }

    /// Return the current guardian set.
    pub fn guardians(env: Env) -> Vec<Address> {
        if let Some(guardians) = env.storage().persistent().get(&DataKey::GuardianSet) {
            return guardians;
        }
        // Legacy (v1) layout: not yet migrated.
        env.storage()
            .instance()
            .get(&DataKey::Guardians)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Storage layout version in effect (issue #184). `1` = legacy instance
    /// layout, `2` = guardians/proposal in persistent storage.
    pub fn storage_layout(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::StorageLayout)
            .unwrap_or(1)
    }

    /// Admin-triggered migration from the v1 instance layout to v2
    /// (issue #184). Moves `Guardians`/`GuardianMembership`/`RecoveryProposal`
    /// out of instance storage into persistent keys. Returns `true` if it
    /// migrated, `false` if the contract was already on v2. Every guardian or
    /// recovery write also migrates lazily, so calling this is optional; it
    /// exists so operators can shrink the instance footprint immediately
    /// after upgrading instead of waiting for the next guardian write.
    pub fn migrate_storage_layout(env: Env, admin: Address) -> Result<bool, WalletError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::bump_instance_ttl(&env);
        Ok(Self::ensure_storage_layout(&env))
    }


    /// Configure (or reconfigure) the M-of-N recovery threshold and the
    /// post-quorum timelock delay. Admin-authorized.
    ///
    /// ## Design decision: rejected while a recovery is pending (issue #28)
    /// A `RecoveryProposal`'s `ready_at` is computed once, at the moment
    /// quorum is reached in `approve_recovery`, and frozen into storage —
    /// it does not retroactively track later `delay_in_ledgers` changes.
    /// Meanwhile `execute_recovery`'s quorum check reads the *live*
    /// `RecoveryConfig.threshold`, not the config in effect when quorum was
    /// reached. That half-live, half-frozen coupling is confusing enough
    /// (and undertested enough — see #28) that the safer design is to
    /// disallow the ambiguity outright: while a `RecoveryProposal` exists,
    /// `set_recovery_config` is rejected with [`WalletError::RecoveryAlreadyPending`].
    /// An admin who wants to change the threshold/delay while a recovery is
    /// in flight must first call `cancel_recovery` (if reachable) — the
    /// already-existing, unambiguous way to stop a pending proposal — rather
    /// than mutate config underneath it.
    ///
    /// # Errors
    /// * [`WalletError::InvalidRecoveryThreshold`] — `threshold <= 1` (a
    ///   single guardian must never be able to unilaterally recover admin).
    /// * [`WalletError::NotEnoughGuardians`] — fewer than
    ///   [`Self::MIN_GUARDIANS_FOR_RECOVERY`] guardians registered, or
    ///   `threshold > guardians.len()`.
    /// * [`WalletError::RecoveryAlreadyPending`] — a `RecoveryProposal` is
    ///   currently in flight; call `cancel_recovery` first.
    /// * [`WalletError::RecoveryDelayTooShort`] — `delay_in_ledgers` is below
    ///   [`Self::MIN_RECOVERY_DELAY_LEDGERS`] (see issue #84).
    pub fn set_recovery_config(
        env: Env,
        admin: Address,
        threshold: u32,
        delay_in_ledgers: u32,
    ) -> Result<(), WalletError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::ensure_storage_layout(&env);
        if Self::recovery_proposal(env.clone()).is_some() {
            return Err(WalletError::RecoveryAlreadyPending);
        }
        let guardians = Self::guardians(env.clone());
        if threshold <= 1 {
            return Err(WalletError::InvalidRecoveryThreshold);
        }
        if guardians.len() < Self::MIN_GUARDIANS_FOR_RECOVERY || threshold > guardians.len() {
            return Err(WalletError::NotEnoughGuardians);
        }
        Self::bump_instance_ttl(&env);
        if delay_in_ledgers < Self::MIN_RECOVERY_DELAY_LEDGERS {
            return Err(WalletError::RecoveryDelayTooShort);
        }
        let config = RecoveryConfig {
            threshold,
            delay_in_ledgers,
        };
        env.storage()
            .instance()
            .set(&DataKey::RecoveryConfig, &config);
        emit_event(&env, "recovery_config_set", (threshold, delay_in_ledgers),
        );
        Ok(())
    }

    /// Return the current recovery configuration, if any.
    pub fn recovery_config(env: Env) -> Option<RecoveryConfig> {
        env.storage().instance().get(&DataKey::RecoveryConfig)
    }

    /// A guardian initiates a recovery to `new_admin`. Counts as that
    /// guardian's own approval.
    ///
    /// # Errors
    /// * [`WalletError::RecoveryNotConfigured`]
    /// * [`WalletError::Unauthorized`] — caller is not a registered guardian.
    /// * [`WalletError::RecoveryAlreadyPending`]
    pub fn initiate_recovery(
        env: Env,
        guardian: Address,
        new_admin: Address,
    ) -> Result<(), WalletError> {
        guardian.require_auth();
        Self::require_guardian(&env, &guardian)?;
        Self::require_recovery_configured(&env)?;
        Self::ensure_storage_layout(&env);
        if Self::recovery_proposal(env.clone()).is_some() {
            return Err(WalletError::RecoveryAlreadyPending);
        }
        Self::bump_instance_ttl(&env);
        let mut approvals: Vec<Address> = Vec::new(&env);
        approvals.push_back(guardian.clone());
        let proposal = RecoveryProposal {
            new_admin: new_admin.clone(),
            approvals,
            ready_at: None,
        };
        Self::ensure_storage_layout(&env);
        Self::store_proposal(&env, &proposal);
        emit_event(&env, "recovery_initiated", (guardian, new_admin),
        );
        Ok(())
    }

    /// A guardian approves the pending recovery proposal.
    ///
    /// Once approvals reach the configured threshold, the timelock is
    /// armed: `ready_at = current_ledger_sequence + delay_in_ledgers`.
    pub fn approve_recovery(env: Env, guardian: Address) -> Result<(), WalletError> {
        guardian.require_auth();
        Self::require_guardian(&env, &guardian)?;
        let config = Self::require_recovery_configured(&env)?;
        let mut proposal = Self::require_pending_recovery(&env)?;
        for i in 0..proposal.approvals.len() {
            if proposal.approvals.get(i).unwrap() == guardian {
                return Err(WalletError::AlreadyApproved);
            }
        }
        Self::bump_instance_ttl(&env);
        proposal.approvals.push_back(guardian.clone());
        if proposal.approvals.len() >= config.threshold && proposal.ready_at.is_none() {
            let ready_at = env
                .ledger()
                .sequence()
                .saturating_add(config.delay_in_ledgers);
            proposal.ready_at = Some(ready_at);
            emit_event(&env, "recovery_quorum_reached", (proposal.new_admin.clone(), ready_at),
            );
        }
        Self::ensure_storage_layout(&env);
        Self::store_proposal(&env, &proposal);
        emit_event(&env, "recovery_approved", guardian);
        Ok(())
    }

    /// A guardian revokes their own approval of the pending recovery.
    ///
    /// If approvals drop below threshold, the timelock is disarmed
    /// (`ready_at` cleared) — quorum must be reached again from scratch,
    /// restarting the delay window.
    ///
    /// # Errors
    /// * [`WalletError::Unauthorized`] — caller is not a currently
    ///   registered guardian. Added for consistency with
    ///   `initiate_recovery`/`approve_recovery`, which both already gate on
    ///   `require_guardian`; this function was the one exception to that
    ///   pattern (see issue #26) — harmless on its own since revoking only
    ///   ever *removes* an approval, but leaving it unchecked meant guardian
    ///   membership wasn't enforced consistently across the whole approval
    ///   lifecycle.
    pub fn revoke_recovery_approval(env: Env, guardian: Address) -> Result<(), WalletError> {
        guardian.require_auth();
        Self::require_guardian(&env, &guardian)?;
        let config = Self::require_recovery_configured(&env)?;
        let mut proposal = Self::require_pending_recovery(&env)?;
        let mut new_approvals: Vec<Address> = Vec::new(&env);
        let mut found = false;
        for i in 0..proposal.approvals.len() {
            let a = proposal.approvals.get(i).unwrap();
            if a == guardian {
                found = true;
            } else {
                new_approvals.push_back(a);
            }
        }
        if !found {
            return Err(WalletError::ApprovalNotFound);
        }
        Self::bump_instance_ttl(&env);
        proposal.approvals = new_approvals;
        if proposal.approvals.len() < config.threshold {
            proposal.ready_at = None;
        }
        Self::ensure_storage_layout(&env);
        Self::store_proposal(&env, &proposal);
        emit_event(&env, "recovery_approval_revoked", guardian);
        Ok(())
    }

    /// Execute a recovery once quorum has been reached and the timelock has
    /// elapsed. Callable by anyone (typically a guardian or the new admin
    /// candidate) — authorization comes entirely from the guardian
    /// signatures already recorded on the proposal, not from the caller.
    ///
    /// Deliberately does **not** call `require_admin`/`current.require_auth()`:
    /// that is precisely the capability that is unavailable when a device is
    /// lost. Re-checks quorum at execution time (not just at
    /// `approve_recovery` time) in case a guardian revoked between quorum
    /// and timelock expiry in a way this contract didn't observe (defense in
    /// depth; `revoke_recovery_approval` already clears `ready_at`, but this
    /// guards against any future code path that forgets to).
    ///
    /// Any in-flight *normal* `propose_admin`/`accept_admin` transfer is
    /// cancelled as part of executing a recovery, so the two flows can't race.
    ///
    /// # Events (see issue #91)
    /// Publishes **two** events, deliberately, not one:
    /// 1. `admin_transferred` — identical topic and payload shape to what
    ///    `accept_admin` publishes for a routine, self-initiated transfer.
    ///    Kept byte-for-byte unchanged so every existing consumer (the
    ///    indexer, the mobile app) that already special-cases nothing about
    ///    *how* the admin changed keeps working without modification.
    /// 2. `recovery_completed` — new, published *in addition to* the above,
    ///    carrying [`RecoveryCompletedEvent`]. This is the signal a
    ///    security-monitoring integration should actually watch: unlike
    ///    `admin_transferred`, its presence unambiguously means "guardian
    ///    quorum just seized control of this wallet," which is precisely
    ///    the moment a wallet owner most needs to be alerted through a side
    ///    channel — and precisely the moment `admin_transferred` alone
    ///    can't tell them that happened. See the doc comment on
    ///    [`RecoveryCompletedEvent`] for why this is a struct rather than a
    ///    tuple like every other event here, and why both events fire
    ///    instead of just picking one.
    ///
    /// # Errors
    /// * [`WalletError::RecoveryNewAdminUnchanged`] — the proposal's
    ///   `new_admin` is identical to the current admin (see issue #42). This
    ///   is a defense-in-depth sanity check, not a proof against a wrong
    ///   target in general: `initiate_recovery` performs no on-chain
    ///   validation of `new_admin` beyond this, so guardians remain the sole
    ///   line of defense against a mistaken or malicious target address.
    pub fn execute_recovery(env: Env) -> Result<(), WalletError> {
        let config = Self::require_recovery_configured(&env)?;
        let proposal = Self::require_pending_recovery(&env)?;
        if proposal.approvals.len() < config.threshold {
            return Err(WalletError::RecoveryNotQuorate);
        }
        let ready_at = proposal.ready_at.ok_or(WalletError::RecoveryNotQuorate)?;
        if env.ledger().sequence() < ready_at {
            return Err(WalletError::RecoveryNotReady);
        }
        let old_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(WalletError::NotInitialized)?;
        if proposal.new_admin == old_admin {
            return Err(WalletError::RecoveryNewAdminUnchanged);
        }
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .remove(&DataKey::PendingAdmin(old_admin.clone()));
        env.storage()
            .instance()
            .set(&DataKey::Admin, &proposal.new_admin);
        Self::remove_proposal(&env);
        // A guardian change queued by the replaced admin is discarded: it
        // was authorized by the very key the guardians just voted out (#175).
        let stale_change: Option<GuardianChange> =
            env.storage().instance().get(&DataKey::PendingGuardianChange);
        if let Some(change) = stale_change {
            env.storage().instance().remove(&DataKey::PendingGuardianChange);
            env.events().publish(
                (Symbol::new(&env, "guardian_change_cancelled"),),
                (change.guardian, change.add),
            );
        }

        // Read once, before either event moves `old_admin`/`new_admin` by
        // value below — both events need independent copies of the same
        // addresses, and Soroban's `Address` is `Clone`, not `Copy`.
        let executed_at = env.ledger().sequence();

        // Event 1/2 — unchanged in name, shape, and ordering relative to
        // every prior release: existing consumers see no difference.
        emit_event(&env, "admin_transferred", (old_admin.clone(), proposal.new_admin.clone()),
        );

        // Event 2/2 — new. See the doc comment above and on
        // `RecoveryCompletedEvent` for the full rationale.
        emit_event(&env, "recovery_completed", RecoveryCompletedEvent {
                old_admin,
                new_admin: proposal.new_admin,
                approving_guardians: proposal.approvals,
                threshold: config.threshold,
                ready_at,
                executed_at,
            },
        );

        Ok(())
    }

    /// The current admin cancels a pending recovery.
    ///
    /// ## Restricted cancel window (issue #175)
    /// Recovery exists for the case where the admin key is lost *or
    /// compromised*. An unrestricted admin cancel let a hostile admin stall
    /// every recovery forever, so cancellation is now limited:
    /// * Before quorum is reached the admin may always cancel.
    /// * After quorum the admin may cancel only during the first half of the
    ///   timelock (`ready_at - delay_in_ledgers / 2`), giving a legitimate
    ///   admin time to object to a colluding majority without letting a
    ///   compromised one front-run `execute_recovery` at the last ledger.
    /// * Once approvals reach a guardian supermajority (at least two thirds
    ///   of the guardian set) the admin can no longer cancel at all — the
    ///   supermajority overrides the admin key.
    ///
    /// # Errors
    /// * [`WalletError::NoPendingRecovery`]
    /// * [`WalletError::RecoveryCancelNotAllowed`] — window closed or
    ///   supermajority reached.
    pub fn cancel_recovery(env: Env, admin: Address) -> Result<(), WalletError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        let proposal = Self::require_pending_recovery(&env)?;
        if !Self::admin_may_cancel_recovery(&env, &proposal) {
            return Err(WalletError::RecoveryCancelNotAllowed);
        }
        Self::bump_instance_ttl(&env);
        Self::remove_proposal(&env);
        emit_event(&env, "recovery_cancelled", admin);
        Ok(())
    }

    /// Whether `cancel_recovery` would currently be accepted (issue #175).
    fn admin_may_cancel_recovery(env: &Env, proposal: &RecoveryProposal) -> bool {
        let guardian_count = Self::guardians(env.clone()).len();
        // approvals / guardians >= 2/3, compared without division.
        if guardian_count > 0 && proposal.approvals.len() * 3 >= guardian_count * 2 {
            return false;
        }
        match (proposal.ready_at, Self::recovery_config(env.clone())) {
            (None, _) => true,
            (Some(ready_at), Some(config)) => {
                let window_closes_at = ready_at.saturating_sub(config.delay_in_ledgers / 2);
                env.ledger().sequence() < window_closes_at
            }
            (Some(_), None) => false,
        }
    }

    /// Return the pending recovery proposal, if any.
    pub fn recovery_proposal(env: Env) -> Option<RecoveryProposal> {
        if let Some(p) = env.storage().persistent().get(&DataKey::PendingRecovery) {
            return Some(p);
        }
        // Legacy (v1) layout: not yet migrated.
        env.storage().instance().get(&DataKey::RecoveryProposal)
    }

    // ── Asset Registry ────────────────────────────────────────────────────────

    /// Maximum assets a single user can whitelist — prevents unbounded O(n)
    /// scans over a user's asset list.
    ///
    /// Chosen to stay well within Soroban per-contract storage (∼100 KB):
    /// each entry is ∼200 bytes → ∼50 entries ≈ 10 KB, far below the ∼100 KB ceiling.
    ///
    /// This is the single source of truth for the limit (see issue #31 — it
    /// used to also exist as a separate module-level `const`, which was
    /// removed since it was unused by enforcement logic and only invited
    /// drift between two supposedly-identical constants).
    pub const MAX_ASSETS: u32 = 50;

    /// Maximum length (bytes) of an `AssetInfo.code`, matching Stellar's
    /// asset code convention (4-char or 12-char alphanumeric codes). See
    /// issue #29.
    pub const MAX_ASSET_CODE_LEN: u32 = 12;

    /// Add an asset to a user's wallet registry.
    ///
    /// Only the user themselves (via `require_auth`) can add assets.
    ///
    /// # Errors
    /// * [`WalletError::InvalidAssetCode`] — `asset.code` is empty or exceeds
    ///   [`Self::MAX_ASSET_CODE_LEN`].
    /// * [`WalletError::AssetAlreadyAdded`] — asset code already registered
    ///   (case-insensitive — see [`AssetInfo::code`]'s doc comment).
    /// * [`WalletError::AssetLimitExceeded`] — user would exceed [`Self::MAX_ASSETS`].
    pub fn add_asset(env: Env, user: Address, asset: AssetInfo) -> Result<(), WalletError> {
        user.require_auth();

        if asset.code.is_empty() || asset.code.len() > Self::MAX_ASSET_CODE_LEN {
            return Err(WalletError::InvalidAssetCode);
        }

        let is_native = asset.code == String::from_str(&env, "XLM");
        if is_native {
            if asset.issuer.is_some() {
                return Err(WalletError::InvalidAssetInfo);
            }
        } else {
            if asset.issuer.is_none() {
                return Err(WalletError::InvalidAssetInfo);
            }
        }

        let mut assets: Vec<AssetInfo> = env
            .storage()
            .persistent()
            .get(&DataKey::UserAssets(user.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        if assets.len() >= Self::MAX_ASSETS {
            return Err(WalletError::AssetLimitExceeded);
        }
        for i in 0..assets.len() {
            if Self::codes_match_case_insensitive(&assets.get(i).unwrap().code, &asset.code) {
                return Err(WalletError::AssetAlreadyAdded);
            }
        }
        Self::bump_instance_ttl(&env);
        assets.push_back(asset.clone());
        env.storage()
            .persistent()
            .set(&DataKey::UserAssets(user.clone()), &assets);
        env.storage().persistent().extend_ttl(
            &DataKey::UserAssets(user.clone()),
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );
        emit_event(&env, "asset_added", (user, asset.code));
        Ok(())
    }

    /// Remove an asset from a user's wallet registry.
    ///
    /// # Errors
    /// * [`WalletError::AssetNotFound`] — asset code not registered.
    pub fn remove_asset(env: Env, user: Address, asset_code: String) -> Result<(), WalletError> {
        user.require_auth();
        let assets: Vec<AssetInfo> = env
            .storage()
            .persistent()
            .get(&DataKey::UserAssets(user.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        let mut new_assets: Vec<AssetInfo> = Vec::new(&env);
        let mut found = false;
        for i in 0..assets.len() {
            let a = assets.get(i).unwrap();
            if a.code == asset_code {
                found = true;
            } else {
                new_assets.push_back(a);
            }
        }
        if !found {
            return Err(WalletError::AssetNotFound);
        }
        Self::bump_instance_ttl(&env);
        env.storage()
            .persistent()
            .set(&DataKey::UserAssets(user.clone()), &new_assets);
        env.storage().persistent().extend_ttl(
            &DataKey::UserAssets(user.clone()),
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );
        emit_event(&env, "asset_removed", (user, asset_code));
        Ok(())
    }

    /// Return all assets registered by a user.
    pub fn get_assets(env: Env, user: Address) -> Vec<AssetInfo> {
        env.storage()
            .persistent()
            .get(&DataKey::UserAssets(user))
            .unwrap_or_else(|| Vec::new(&env))
    }



    // ── Spend Limits ──────────────────────────────────────────────────────────
    //
    // Limits and daily-spent records are keyed by `(user, token_id)` where
    // `token_id` is the token *contract* address (`send` moves exactly that
    // contract), never a caller-supplied display code (issue #173). Display
    // codes are derived off-chain (e.g. from the SAC's `symbol()`).

    /// Set a rolling 24 h spend limit (in stroops) for a specific asset.
    ///
    /// `limit = 0` removes the limit (unlimited).
    ///
    /// ## Decreases are immediate, increases are delayed (issue #176)
    /// Spend limits exist to cap the loss from a compromised user key, and
    /// that same key is all `set_spend_limit` requires. So:
    /// * a **decrease** (any non-zero limit `<=` the current effective limit,
    ///   or any non-zero limit when currently unlimited) takes effect at once
    ///   and discards any queued increase;
    /// * an **increase** (or a switch to unlimited) is stored as a
    ///   [`PendingSpendLimit`] that only takes effect
    ///   [`SPEND_LIMIT_INCREASE_DELAY_SECS`] later, emitting
    ///   `spend_limit_increase_pending` so the backend can alert the owner,
    ///   who can call `cancel_pending_spend_limit` (as can any guardian).
    ///   Spends above the old limit keep failing until the delay elapses.
    ///
    /// **Retroactive enforcement:** if the user has already spent more than
    /// a proposed lower limit in the current day window, the call is rejected
    /// with `SpendLimitExceeded`.
    ///
    /// # Errors
    /// * [`WalletError::InvalidSpendLimit`] — negative limit.
    /// * [`WalletError::SpendLimitExceeded`] — current day's spend already
    ///   exceeds the proposed (lower) limit.
    pub fn set_spend_limit(
        env: Env,
        user: Address,
        token_id: Address,
        limit: i128,
    ) -> Result<(), WalletError> {
        user.require_auth();
        if limit < 0 {
            return Err(WalletError::InvalidSpendLimit);
        }
        Self::bump_instance_ttl(&env);
        Self::promote_matured_spend_limit(&env, &user, &token_id);
        let current = Self::stored_spend_limit(&env, &user, &token_id);
        let is_decrease = limit != 0 && (current == 0 || limit <= current);
        let is_noop = limit == current;

        if is_decrease || is_noop {
            // Retroactive check against the rolling window. Spends are
            // tracked even while no limit is set (issue #179), so a limit
            // enabled after a large spend sees that spend here.
            if limit != 0 {
                let window =
                    Self::load_spend_window(&env, &user, &token_id, env.ledger().timestamp());
                if Self::window_total(&window) > limit {
                    return Err(WalletError::SpendLimitExceeded);
                }
            }
            Self::write_spend_limit(&env, &user, &token_id, limit);
            let pending_key = DataKey::PendingSpendLimit(user.clone(), token_id.clone());
            if env.storage().persistent().has(&pending_key) {
                env.storage().persistent().remove(&pending_key);
                emit_event(
                    &env,
                    "spend_limit_increase_cancelled",
                    (user.clone(), token_id.clone()),
                );
            }
            emit_event(&env, "spend_limit_set", (user, token_id, limit));
            return Ok(());
        }

        let effective_at = env
            .ledger()
            .timestamp()
            .saturating_add(SPEND_LIMIT_INCREASE_DELAY_SECS);
        let key = DataKey::PendingSpendLimit(user.clone(), token_id.clone());
        env.storage()
            .persistent()
            .set(&key, &PendingSpendLimit { limit, effective_at });
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );
        emit_event(
            &env,
            "spend_limit_increase_pending",
            (user, token_id, current, limit, effective_at),
        );
        Ok(())
    }

    /// Store `limit` for (user, token) and keep the opt-in marker in step
    /// (issue #185): set for a non-zero limit, cleared for unlimited.
    fn write_spend_limit(env: &Env, user: &Address, token_id: &Address, limit: i128) {
        let storage = env.storage().persistent();
        let key = DataKey::TokenSpendLimit(user.clone(), token_id.clone());
        let opt_in = DataKey::LimitOptIn(user.clone(), token_id.clone());
        if limit == 0 {
            storage.remove(&key);
            storage.remove(&opt_in);
            return;
        }
        storage.set(&key, &limit);
        storage.extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
        storage.set(&opt_in, &true);
        storage.extend_ttl(&opt_in, OPT_IN_TTL_THRESHOLD, OPT_IN_TTL_EXTEND_TO);
    }

    fn stored_spend_limit(env: &Env, user: &Address, token_id: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TokenSpendLimit(user.clone(), token_id.clone()))
            .unwrap_or(0)
    }

    /// Apply a pending increase whose delay has elapsed.
    fn promote_matured_spend_limit(env: &Env, user: &Address, token_id: &Address) {
        let key = DataKey::PendingSpendLimit(user.clone(), token_id.clone());
        let pending: Option<PendingSpendLimit> = env.storage().persistent().get(&key);
        if let Some(p) = pending {
            if env.ledger().timestamp() >= p.effective_at {
                Self::write_spend_limit(env, user, token_id, p.limit);
                env.storage().persistent().remove(&key);
                emit_event(env, "spend_limit_set", (user.clone(), token_id.clone(), p.limit));
            }
        }
    }

    /// The pending limit increase for (user, token), if any.
    pub fn pending_spend_limit(env: Env, user: Address, token_id: Address) -> Option<PendingSpendLimit> {
        env.storage()
            .persistent()
            .get(&DataKey::PendingSpendLimit(user, token_id))
    }

    /// Cancel a pending limit increase before it takes effect. The owner or
    /// any guardian may cancel.
    ///
    /// # Errors
    /// * [`WalletError::NoPendingSpendLimit`]
    pub fn cancel_pending_spend_limit(
        env: Env,
        caller: Address,
        user: Address,
        token_id: Address,
    ) -> Result<(), WalletError> {
        caller.require_auth();
        if caller != user {
            Self::require_guardian(&env, &caller)?;
        }
        let key = DataKey::PendingSpendLimit(user.clone(), token_id.clone());
        let pending: Option<PendingSpendLimit> = env.storage().persistent().get(&key);
        match pending {
            Some(p) if env.ledger().timestamp() < p.effective_at => {}
            _ => return Err(WalletError::NoPendingSpendLimit),
        }
        Self::bump_instance_ttl(&env);
        env.storage().persistent().remove(&key);
        emit_event(&env, "spend_limit_increase_cancelled", (user, token_id));
        Ok(())
    }

    /// Admin: move a legacy `(user, asset_code)` limit and spend record onto
    /// the token-keyed storage (issue #173). The stricter limit wins.
    /// Returns `false` when there was nothing to migrate.
    pub fn migrate_spend_limit(
        env: Env,
        admin: Address,
        user: Address,
        asset_code: String,
        token_id: Address,
    ) -> Result<bool, WalletError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        let legacy_limit_key = DataKey::SpendLimit(user.clone(), asset_code.clone());
        let legacy_spent_key = DataKey::DailySpent(user.clone(), asset_code.clone());
        let legacy_limit: Option<i128> = env.storage().persistent().get(&legacy_limit_key);
        let Some(legacy_limit) = legacy_limit else {
            return Ok(false);
        };
        Self::bump_instance_ttl(&env);
        let existing = Self::stored_spend_limit(&env, &user, &token_id);
        let merged = match (existing, legacy_limit) {
            (0, l) => l,
            (e, 0) => e,
            (e, l) => e.min(l),
        };
        Self::write_spend_limit(&env, &user, &token_id, merged);

        let legacy_spent: Option<SpendRecord> = env.storage().persistent().get(&legacy_spent_key);
        if let Some(record) = legacy_spent {
            let new_key = DataKey::TokenDailySpent(user.clone(), token_id.clone());
            let current: Option<SpendRecord> = env.storage().persistent().get(&new_key);
            let merged_record = match current {
                Some(c) if c.day == record.day => SpendRecord {
                    amount: c.amount.saturating_add(record.amount),
                    day: c.day,
                },
                Some(c) if c.day > record.day => c,
                _ => record,
            };
            env.storage().persistent().set(&new_key, &merged_record);
            env.storage().persistent().extend_ttl(
                &new_key,
                DAILY_SPENT_TTL_THRESHOLD,
                DAILY_SPENT_TTL_EXTEND_TO,
            );
        }
        env.storage().persistent().remove(&legacy_limit_key);
        env.storage().persistent().remove(&legacy_spent_key);
        emit_event(
            &env,
            "spend_limit_migrated",
            (user, asset_code, token_id, merged),
        );
        Ok(true)
    }

    /// Effective daily cap for (user, token); 0 = unlimited. Panics with
    /// `SpendLimitArchived` if the limit was archived (issue #185).
    pub fn get_spend_limit(env: Env, user: Address, token_id: Address) -> i128 {
        match Self::effective_limit(&env, &user, &token_id) {
            Ok(limit) => limit,
            Err(e) => panic_with_error!(&env, e),
        }
    }

    /// `true` when a limit was set but its entry has been archived.
    pub fn is_limit_archived(env: Env, user: Address, token_id: Address) -> bool {
        Self::effective_limit(&env, &user, &token_id).is_err()
    }

    /// Keep a user's entries alive (issue #185). Permissionless so a keeper
    /// can pay for it. Returns how many entries were extended.
    pub fn extend_user_ttl(env: Env, user: Address) -> u32 {
        Self::bump_instance_ttl(&env);
        let storage = env.storage().persistent();
        let mut extended: u32 = 0;
        let assets_key = DataKey::UserAssets(user.clone());
        if storage.has(&assets_key) {
            storage.extend_ttl(&assets_key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
            extended += 1;
        }
        // Spend state is keyed by token, so walk the allowlisted tokens.
        for token_id in Self::get_allowed_tokens(env.clone()).iter() {
            let limit_key = DataKey::TokenSpendLimit(user.clone(), token_id.clone());
            if storage.has(&limit_key) {
                storage.extend_ttl(&limit_key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
                extended += 1;
            }
            let opt_key = DataKey::LimitOptIn(user.clone(), token_id.clone());
            if storage.has(&opt_key) {
                storage.extend_ttl(&opt_key, OPT_IN_TTL_THRESHOLD, OPT_IN_TTL_EXTEND_TO);
                extended += 1;
            }
            let window_key = DataKey::SpendWindow(user.clone(), token_id.clone());
            if storage.has(&window_key) {
                storage.extend_ttl(&window_key, DAILY_SPENT_TTL_THRESHOLD, DAILY_SPENT_TTL_EXTEND_TO);
                extended += 1;
            }
            let pending_key = DataKey::PendingSpendLimit(user.clone(), token_id.clone());
            if storage.has(&pending_key) {
                storage.extend_ttl(&pending_key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
                extended += 1;
            }
        }
        emit_event(&env, "user_ttl_extended", (user, extended));
        extended
    }

    /// Limit in force now, counting a matured pending increase. An opt-in
    /// marker without a limit entry means the limit was archived: fail safe.
    fn effective_limit(env: &Env, user: &Address, token_id: &Address) -> Result<i128, WalletError> {
        let storage = env.storage().persistent();
        let pending: Option<PendingSpendLimit> =
            storage.get(&DataKey::PendingSpendLimit(user.clone(), token_id.clone()));
        if let Some(p) = pending {
            if env.ledger().timestamp() >= p.effective_at {
                return Ok(p.limit);
            }
        }
        match storage.get::<_, i128>(&DataKey::TokenSpendLimit(user.clone(), token_id.clone())) {
            Some(limit) => Ok(limit),
            None => {
                if storage.has(&DataKey::LimitOptIn(user.clone(), token_id.clone())) {
                    Err(WalletError::SpendLimitArchived)
                } else {
                    Ok(0)
                }
            }
        }
    }

    /// Amount spent in the trailing 24 h window.
    pub fn get_spent_today(env: Env, user: Address, token_id: Address) -> i128 {
        let window = Self::load_spend_window(&env, &user, &token_id, env.ledger().timestamp());
        Self::window_total(&window)
    }

    /// Limit, spend and refill times for the rolling window (issue #177).
    pub fn get_spend_allowance(env: Env, user: Address, token_id: Address) -> SpendAllowance {
        let now = env.ledger().timestamp();
        let limit = Self::get_spend_limit(env.clone(), user.clone(), token_id.clone());
        let window = Self::load_spend_window(&env, &user, &token_id, now);
        let spent = Self::window_total(&window);
        let remaining = if limit == 0 {
            0
        } else {
            (limit - spent).max(0)
        };
        let first_hour = Self::window_first_hour(window.head_hour);
        let mut oldest: Option<u64> = None;
        let mut newest: Option<u64> = None;
        let mut h = first_hour;
        while h <= window.head_hour {
            if window.buckets.get(Self::spend_slot(h)).unwrap_or(0) != 0 {
                if oldest.is_none() {
                    oldest = Some(h);
                }
                newest = Some(h);
            }
            h += 1;
        }
        let expiry = |hour: u64| (hour + SPEND_WINDOW_BUCKETS as u64) * SPEND_BUCKET_SECONDS;
        SpendAllowance {
            limit,
            spent,
            remaining,
            window_start: first_hour * SPEND_BUCKET_SECONDS,
            window_resets_at: newest.map(expiry).unwrap_or(now),
            next_refill_at: oldest.map(expiry).unwrap_or(0),
        }
    }

    fn spend_slot(hour: u64) -> u32 {
        (hour % SPEND_WINDOW_BUCKETS as u64) as u32
    }

    fn window_first_hour(head_hour: u64) -> u64 {
        head_hour.saturating_sub(SPEND_WINDOW_BUCKETS as u64 - 1)
    }

    fn window_total(window: &SpendWindow) -> i128 {
        let mut total: i128 = 0;
        for v in window.buckets.iter() {
            total = total.saturating_add(v);
        }
        total
    }

    /// Load the (user, asset) window and advance it to `now` in memory.
    /// Never writes: views use it too.
    ///
    /// When no window exists yet but a legacy fixed-day `DailySpent` record
    /// does (pre-#177 data), its amount is placed in the current hour's
    /// bucket if any of that day could still fall inside the last 24 h. That
    /// over-counts (the amount stays counted for up to 25 h from now) but
    /// never under-counts across the upgrade.
    fn load_spend_window(env: &Env, user: &Address, token_id: &Address, now: u64) -> SpendWindow {
        let hour = now / SPEND_BUCKET_SECONDS;
        let stored: Option<SpendWindow> = env
            .storage()
            .persistent()
            .get(&DataKey::SpendWindow(user.clone(), token_id.clone()));
        let mut window = match stored {
            Some(w) if w.buckets.len() == SPEND_WINDOW_BUCKETS => w,
            _ => {
                let mut buckets: Vec<i128> = Vec::new(env);
                for _ in 0..SPEND_WINDOW_BUCKETS {
                    buckets.push_back(0);
                }
                let mut w = SpendWindow { head_hour: hour, buckets };
                let legacy: Option<SpendRecord> = env
                    .storage()
                    .persistent()
                    .get(&DataKey::TokenDailySpent(user.clone(), token_id.clone()));
                if let Some(r) = legacy {
                    let legacy_end = r.day.saturating_add(1).saturating_mul(SECONDS_PER_DAY);
                    if r.amount > 0 && legacy_end.saturating_add(SECONDS_PER_DAY) > now {
                        w.buckets.set(Self::spend_slot(hour), r.amount);
                    }
                }
                w
            }
        };
        Self::advance_spend_window(&mut window, hour);
        window
    }

    /// Zero every bucket that has fallen out of the window by `hour`.
    fn advance_spend_window(window: &mut SpendWindow, hour: u64) {
        if hour <= window.head_hour {
            return;
        }
        let gap = hour - window.head_hour;
        if gap >= SPEND_WINDOW_BUCKETS as u64 {
            for i in 0..SPEND_WINDOW_BUCKETS {
                window.buckets.set(i, 0);
            }
        } else {
            let mut h = window.head_hour + 1;
            while h <= hour {
                window.buckets.set(Self::spend_slot(h), 0);
                h += 1;
            }
        }
        window.head_hour = hour;
    }

    /// Record a spend and reject if it would exceed the rolling 24 h limit.
    ///
    /// Call this from any payment-execution path to enforce limits. The
    /// spend is recorded even when no limit is set (issue #179). The window
    /// is the trailing 24 h (hourly buckets plus one guard bucket, see
    /// [`SPEND_WINDOW_BUCKETS`]), so there is no midnight reset to exploit
    /// (issue #177).
    ///
    /// Reentrancy invariant: keep the interval from reading `SpendWindow`
    /// through writing its replacement free of external contract calls. See
    /// `docs/record-spend-reentrancy.md` for the proof and change guidance.
    ///
    /// `amount` must be strictly positive. `require_auth()` on `user`
    /// authenticates the *caller*, not the *value* — in the compromised-key
    /// threat model this function exists to defend against, the attacker
    /// can already produce valid `user` signatures, so `require_auth()`
    /// alone provides no protection here. A non-positive `amount` would let
    /// that same attacker call `record_spend` with a negative value to
    /// decrease (or zero out) `spent_today` below what was actually spent,
    /// then immediately follow it with a legitimate large spend the
    /// configured limit was supposed to block — silently defeating the
    /// limit. See issue #25 for the full walkthrough.
    ///
    /// # Errors
    /// * [`WalletError::InvalidSpendLimit`] — `amount` is not strictly
    ///   positive.
    /// * [`WalletError::SpendLimitExceeded`]
    pub fn record_spend(
        env: Env,
        user: Address,
        token_id: Address,
        amount: i128,
    ) -> Result<(), WalletError> {
        user.require_auth();
        if amount <= 0 {
            return Err(WalletError::InvalidSpendLimit);
        }
        // A real spend is real wallet activity regardless of whether a
        // limit happens to be configured for this asset (see
        // `bump_instance_ttl`'s doc comment).
        Self::bump_instance_ttl(&env);
        Self::promote_matured_spend_limit(&env, &user, &token_id);
        let limit = Self::effective_limit(&env, &user, &token_id)?;
        // Always record, limit or not (issue #179): a limit switched on
        // later must see spends made while the token was unlimited.
        let now = env.ledger().timestamp();
        let mut window = Self::load_spend_window(&env, &user, &token_id, now);
        let spent = Self::window_total(&window);
        let new_spent = match spent.checked_add(amount) {
            Some(v) => v,
            // Unlimited tokens must never be blocked by bookkeeping.
            None if limit == 0 => i128::MAX,
            None => return Err(WalletError::SpendOverflow),
        };
        if limit != 0 && new_spent > limit {
            return Err(WalletError::SpendLimitExceeded);
        }
        let slot = Self::spend_slot(window.head_hour);
        let bucket = window.buckets.get(slot).unwrap_or(0);
        window.buckets.set(slot, bucket.saturating_add(amount));
        let key = DataKey::SpendWindow(user.clone(), token_id.clone());
        env.storage().persistent().set(&key, &window);
        env.storage().persistent().extend_ttl(
            &key,
            DAILY_SPENT_TTL_THRESHOLD,
            DAILY_SPENT_TTL_EXTEND_TO,
        );
        // The legacy record has been folded into the window; drop it.
        let legacy_key = DataKey::TokenDailySpent(user.clone(), token_id.clone());
        if env.storage().persistent().has(&legacy_key) {
            env.storage().persistent().remove(&legacy_key);
        }
        emit_event(&env, "spend_recorded", (user, token_id, amount, new_spent, limit));
        Ok(())
    }

    // ── Wiring: globe-wallet <-> token-wrapper ───────────────────────────────────
    //
    // See docs/design/architecture.md ("Future: wiring the contracts
    // together") and docs/design/wiring-reentrancy-threat-model.md for the
    // full design rationale. Summary: `send` enforces the daily spend limit
    // (via `record_spend`, called as a direct in-frame function call — not a
    // cross-contract invocation, so its existing reentrancy proof is
    // unaffected) and only then calls out to `token-wrapper::transfer_from`,
    // and only for a `token_id` the admin has explicitly allowlisted.

    /// Admin: set the token-wrapper contract instance `send` calls into.
    pub fn set_token_wrapper(env: Env, admin: Address, token_wrapper_id: Address) -> Result<(), WalletError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DataKey::TokenWrapperId, &token_wrapper_id);
        emit_event(&env, "token_wrapper_set", token_wrapper_id,
        );
        Ok(())
    }

    /// Returns the currently configured token-wrapper contract instance, if any.
    pub fn get_token_wrapper(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::TokenWrapperId)
    }

    /// Delay (in ledgers) between `propose_allowed_token` and
    /// `execute_allowed_token` becoming callable (issue #189). One day gives
    /// monitors watching `token_allowlist_proposed` time to react before a
    /// token becomes movable via `send`.
    pub const ALLOWLIST_DELAY_LEDGERS: u32 = LEDGERS_PER_DAY;

    /// Allowlist manager: propose `token_id` for the `send` allowlist.
    ///
    /// The contract only accepts genuine Stellar Asset Contracts (issue
    /// #189): it rebuilds the classic asset's XDR from `asset_code` +
    /// `issuer_key` (raw ed25519 issuer key; `None` = native XLM), derives the
    /// SAC address the network would assign to that asset, and rejects the
    /// proposal unless it equals `token_id`. A custom contract that merely
    /// *claims* to be "USDC" can never match, because a SAC's address is a
    /// pure function of the asset it wraps. The addition only takes effect
    /// after [`Self::ALLOWLIST_DELAY_LEDGERS`] via `execute_allowed_token`.
    ///
    /// # Errors
    /// * [`WalletError::Unauthorized`] — caller lacks [`Role::AllowlistManager`]
    /// * [`WalletError::InvalidAssetCode`] / [`WalletError::InvalidAssetInfo`]
    /// * [`WalletError::TokenNotStellarAsset`] — `token_id` is not that asset's SAC
    /// * [`WalletError::AllowlistAlreadyPending`] — already proposed or allowed
    pub fn propose_allowed_token(
        env: Env,
        caller: Address,
        token_id: Address,
        asset_code: String,
        issuer_key: Option<BytesN<32>>,
    ) -> Result<(), WalletError> {
        caller.require_auth();
        Self::require_role(&env, &caller, Role::AllowlistManager)?;
        let pending_key = DataKey::PendingAllowedToken(token_id.clone());
        if env.storage().persistent().has(&pending_key)
            || Self::is_token_allowed(env.clone(), token_id.clone())
        {
            return Err(WalletError::AllowlistAlreadyPending);
        }
        let derived = Self::derive_sac_address(&env, &asset_code, &issuer_key)?;
        if derived != token_id {
            return Err(WalletError::TokenNotStellarAsset);
        }
        Self::bump_instance_ttl(&env);
        let ready_at = env
            .ledger()
            .sequence()
            .saturating_add(Self::ALLOWLIST_DELAY_LEDGERS);
        let pending = PendingAllowedToken {
            info: AllowedTokenInfo {
                token_id: token_id.clone(),
                asset_code: asset_code.clone(),
                issuer_key: issuer_key.clone().into(),
            },
            proposed_by: caller.clone(),
            ready_at,
        };
        env.storage().persistent().set(&pending_key, &pending);
        env.storage().persistent().extend_ttl(
            &pending_key,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );
        emit_event(
            &env,
            "token_allowlist_proposed",
            TokenAllowlistProposedEvent {
                token_id,
                asset_code,
                issuer_key: issuer_key.into(),
                proposed_by: caller,
                ready_at,
            },
        );
        Ok(())
    }

    /// Allowlist manager: finalize a proposal once its timelock elapsed.
    ///
    /// # Errors
    /// * [`WalletError::Unauthorized`] — caller lacks [`Role::AllowlistManager`]
    /// * [`WalletError::AllowlistProposalNotFound`]
    /// * [`WalletError::AllowlistNotReady`] — timelock still running
    pub fn execute_allowed_token(env: Env, caller: Address, token_id: Address) -> Result<(), WalletError> {
        caller.require_auth();
        Self::require_role(&env, &caller, Role::AllowlistManager)?;
        let pending_key = DataKey::PendingAllowedToken(token_id.clone());
        let pending: PendingAllowedToken = env
            .storage()
            .persistent()
            .get(&pending_key)
            .ok_or(WalletError::AllowlistProposalNotFound)?;
        if env.ledger().sequence() < pending.ready_at {
            return Err(WalletError::AllowlistNotReady);
        }
        Self::bump_instance_ttl(&env);
        env.storage().persistent().remove(&pending_key);

        let key = DataKey::AllowedToken(token_id.clone());
        env.storage().persistent().set(&key, &true);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );
        let info_key = DataKey::AllowedTokenInfo(token_id.clone());
        env.storage().persistent().set(&info_key, &pending.info);
        env.storage().persistent().extend_ttl(
            &info_key,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );

        let mut list: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::AllowedTokens)
            .unwrap_or_else(|| Vec::new(&env));
        if !list.contains(&token_id) {
            list.push_back(token_id.clone());
            env.storage().instance().set(&DataKey::AllowedTokens, &list);
        }

        emit_event(
            &env,
            "token_allowed",
            TokenAllowedEvent {
                token_id,
                asset_code: pending.info.asset_code,
                issuer_key: pending.info.issuer_key,
                executed_by: caller,
            },
        );
        Ok(())
    }

    /// Allowlist manager: drop a pending proposal before it is executed.
    pub fn cancel_allowed_token(env: Env, caller: Address, token_id: Address) -> Result<(), WalletError> {
        caller.require_auth();
        Self::require_role(&env, &caller, Role::AllowlistManager)?;
        let pending_key = DataKey::PendingAllowedToken(token_id.clone());
        if !env.storage().persistent().has(&pending_key) {
            return Err(WalletError::AllowlistProposalNotFound);
        }
        Self::bump_instance_ttl(&env);
        env.storage().persistent().remove(&pending_key);
        emit_event(
            &env,
            "token_allowlist_cancelled",
            TokenAllowlistCancelledEvent {
                token_id,
                cancelled_by: caller,
            },
        );
        Ok(())
    }

    /// Return the pending (timelocked) allowlist proposal for `token_id`.
    pub fn pending_allowed_token(env: Env, token_id: Address) -> Option<PendingAllowedToken> {
        env.storage()
            .persistent()
            .get(&DataKey::PendingAllowedToken(token_id))
    }

    /// Return the verified asset metadata stored with an allowlisted token.
    pub fn allowed_token_info(env: Env, token_id: Address) -> Option<AllowedTokenInfo> {
        env.storage()
            .persistent()
            .get(&DataKey::AllowedTokenInfo(token_id))
    }

    /// Allowlist manager: remove `token_id` from the send-allowlist.
    ///
    /// Removal is immediate (no timelock) — shrinking the allowlist can only
    /// reduce what `send` is able to move.
    pub fn remove_allowed_token(env: Env, caller: Address, token_id: Address) -> Result<(), WalletError> {
        caller.require_auth();
        Self::require_role(&env, &caller, Role::AllowlistManager)?;
        env.storage()
            .persistent()
            .remove(&DataKey::AllowedToken(token_id.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::AllowedTokenInfo(token_id.clone()));

        let list: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::AllowedTokens)
            .unwrap_or_else(|| Vec::new(&env));
        let mut new_list = Vec::new(&env);
        for i in 0..list.len() {
            let item = list.get(i).unwrap();
            if item != token_id {
                new_list.push_back(item);
            }
        }
        env.storage().instance().set(&DataKey::AllowedTokens, &new_list);
        Self::bump_instance_ttl(&env);

        emit_event(
            &env,
            "token_disallowed",
            TokenDisallowedEvent {
                token_id,
                removed_by: caller,
            },
        );
        Ok(())
    }

    // ── Roles & pause (issue #190) ───────────────────────────────────────────

    /// Admin: grant `role` to `account`.
    pub fn grant_role(env: Env, admin: Address, role: Role, account: Address) -> Result<(), WalletError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .set(&DataKey::RoleMember(role, account.clone()), &true);
        emit_event(
            &env,
            "role_granted",
            RoleGrantedEvent {
                role,
                account,
                granted_by: admin,
            },
        );
        Ok(())
    }

    /// Admin: revoke `role` from `account`.
    pub fn revoke_role(env: Env, admin: Address, role: Role, account: Address) -> Result<(), WalletError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .remove(&DataKey::RoleMember(role, account.clone()));
        emit_event(
            &env,
            "role_revoked",
            RoleRevokedEvent {
                role,
                account,
                revoked_by: admin,
            },
        );
        Ok(())
    }

    /// Whether `account` holds `role` (the admin implicitly holds all roles).
    pub fn has_role(env: Env, role: Role, account: Address) -> bool {
        Self::require_role(&env, &account, role).is_ok()
    }

    /// Pauser: block `send` until `unpause`.
    pub fn pause(env: Env, caller: Address) -> Result<(), WalletError> {
        Self::set_paused(&env, caller, true)
    }

    /// Pauser: re-enable `send`.
    pub fn unpause(env: Env, caller: Address) -> Result<(), WalletError> {
        Self::set_paused(&env, caller, false)
    }

    /// Whether `send` is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
    }

    /// Returns whether `token_id` is currently allowlisted for `send`.
    pub fn is_token_allowed(env: Env, token_id: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::AllowedToken(token_id))
            .unwrap_or(false)
    }

    /// Return the list of all allowed token contract addresses.
    pub fn get_allowed_tokens(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::AllowedTokens)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Return the list of all allowed token contract addresses (alias).
    pub fn allowed_tokens(env: Env) -> Vec<Address> {
        Self::get_allowed_tokens(env)
    }

    /// Atomically enforce the daily spend limit and move `amount` of
    /// `token_id` from `user` to `to`, via `token-wrapper::transfer_from`.
    ///
    /// `user` must have already granted this contract (i.e.
    /// `env.current_contract_address()`) an allowance scoped to `token_id`
    /// via `token-wrapper::approve(user, wallet, token_id, ..)` before
    /// calling this — matching `docs/design/architecture.md`'s intended
    /// integration flow.
    ///
    /// The daily limit charged is the one for `token_id` itself; there is no
    /// separate asset-code argument to disagree with it (issue #173).
    ///
    /// ## Who signs (auth tree, issue #174)
    /// `user` signs one authorization tree rooted at `send`; inside it the
    /// token's own `transfer(user, to, amount)` sub-invocation (made by
    /// token-wrapper) also requires `user`. This contract authorizes itself
    /// as the token-wrapper `spender` implicitly (direct caller). See
    /// `docs/design/token-wrapper-auth-model.md`.
    ///
    /// # Errors
    /// * [`WalletError::ContractPaused`] if a pauser has paused the contract.
    /// * [`WalletError::TokenNotAllowed`] if `token_id` is not allowlisted.
    /// * [`WalletError::TokenWrapperNotSet`] if no admin has configured the
    ///   token-wrapper instance yet.
    /// * [`WalletError::SpendLimitExceeded`] / [`WalletError::SpendOverflow`]
    ///   per `record_spend`'s existing rules.
    ///
    /// A failure at any step reverts the whole call, including any
    /// `record_spend` write already applied in this same invocation —
    /// Soroban transactions are all-or-nothing, so there is no path where
    /// the daily counter advances without the underlying transfer actually
    /// succeeding (or vice versa).
    pub fn send(
        env: Env,
        user: Address,
        token_id: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), WalletError> {
        // NOTE: `user` is authorized by `record_spend`'s own `require_auth`
        // call below, not here — Soroban's auth framework treats a second
        // `require_auth` for the same address within the same frame as
        // re-authorizing an already-authorized signer (`Auth,
        // ExistingValue` / "frame is already authorized"), so this function
        // must not call it a second time itself.

        // 0. Emergency pause (issue #191). Checked before anything else so a
        //    paused contract never touches the spend counter or calls out.
        if Self::is_send_paused(env.clone()) {
            return Err(WalletError::SendsPaused);
        }

        // 1. Allowlist check — see threat-model doc §4, mitigation 1. Done
        //    first and before any state mutation so a disallowed token_id
        //    never touches the daily-spend counter at all. This does not
        //    require authorization, so it's safe to run before `user` is
        //    authorized by the record_spend call below.
        if Self::is_paused(env.clone()) {
            return Err(WalletError::ContractPaused);
        }
        if !Self::is_token_allowed(env.clone(), token_id.clone()) {
            return Err(WalletError::TokenNotAllowed);
        }

        // 2. Effects: finalize every one of globe-wallet's own state changes
        //    for this operation before the one external call below. This is
        //    a plain associated-function call (same host frame), so
        //    record_spend's existing reentrancy proof
        //    (docs/record-spend-reentrancy.md) is untouched by this wiring.
        Self::record_spend(env.clone(), user.clone(), token_id.clone(), amount)?;

        let wrapper_id: Address = env
            .storage()
            .instance()
            .get(&DataKey::TokenWrapperId)
            .ok_or(WalletError::TokenWrapperNotSet)?;

        // 3. Interaction: the one external call in this function, made last.
        //    See threat-model doc §3 for why neither token-wrapper nor an
        //    adversarial token_id can call back into GlobeWallet (or into
        //    token-wrapper itself) while this frame is on the stack, and
        //    `test_send_rejects_reentrant_malicious_token` for the
        //    executable proof against a real mock malicious token contract.
        let wrapper_client = TokenWrapperClient::new(&env, &wrapper_id);
        match wrapper_client.try_transfer_from(
            &env.current_contract_address(),
            &token_id,
            &user,
            &to,
            &amount,
            // No decimals hint: amount is already in the token's base units.
            &None,
        ) {
            Ok(Ok(())) => {
                emit_event(
                    &env,
                    "send_executed",
                    SendExecutedEvent {
                        user,
                        token_id,
                        to,
                        amount,
                    },
                );
                Ok(())
            }
            // Ok(Err(_)): token-wrapper returned a typed WrapperError (bad
            // allowance, invalid amount, ...). Err(_): the call couldn't be
            // completed at all (e.g. conversion/invoke-level failure). Both
            // collapse to one WalletError — the specific WrapperError is
            // still visible in the transaction's diagnostic events for
            // debugging, and either way the whole transaction (including
            // the record_spend write above) reverts.
            Ok(Err(_)) | Err(_) => Err(WalletError::TokenTransferFailed),
        }
    }

    // ── Emergency pause (issue #191) ─────────────────────────────────────────
    //
    // Scope: the pause only blocks `send`, the one entrypoint that moves
    // funds. Admin rotation, upgrades, guardian management and recovery all
    // keep working while paused, so a pause can never lock the owners out of
    // fixing the incident (or recovering a compromised admin key).
    //
    // Roles: the pauser (a hot incident-response key) and the admin can both
    // pause. Only the admin can unpause — when the admin is a multisig account
    // that is what makes unpausing a multisig decision. A leaked pauser key
    // can at worst stop sends, never resume them or change anything else.

    /// Admin: set (or clear, with `None`) the address allowed to pause sends.
    pub fn set_pauser(env: Env, admin: Address, pauser: Option<Address>) -> Result<(), WalletError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        Self::bump_instance_ttl(&env);
        match &pauser {
            Some(p) => env.storage().instance().set(&DataKey::Pauser, p),
            None => env.storage().instance().remove(&DataKey::Pauser),
        }
        env.events()
            .publish((Symbol::new(&env, "pauser_set"),), (admin, pauser));
        Ok(())
    }

    /// The address currently allowed to pause sends, if any.
    pub fn pauser(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Pauser)
    }

    /// Pauser or admin: stop `send` until the admin unpauses. Idempotent —
    /// pausing an already-paused contract succeeds without a second event.
    ///
    /// # Errors
    /// * [`WalletError::Unauthorized`] if `caller` is neither pauser nor admin.
    pub fn pause_sends(env: Env, caller: Address) -> Result<(), WalletError> {
        caller.require_auth();
        let is_pauser = Self::pauser(env.clone()).map_or(false, |p| p == caller);
        if !is_pauser {
            Self::require_admin(&env, &caller)?;
        }
        if Self::is_send_paused(env.clone()) {
            return Ok(());
        }
        Self::bump_instance_ttl(&env);
        env.storage().instance().set(&DataKey::SendsPaused, &true);
        env.events().publish(
            (Symbol::new(&env, "sends_paused"),),
            (caller, env.ledger().sequence()),
        );
        Ok(())
    }

    /// Admin only: resume `send`. Idempotent like [`Self::pause_sends`].
    ///
    /// # Errors
    /// * [`WalletError::Unauthorized`] for anyone but the admin — including the pauser.
    pub fn unpause_sends(env: Env, admin: Address) -> Result<(), WalletError> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        if !Self::is_send_paused(env.clone()) {
            return Ok(());
        }
        Self::bump_instance_ttl(&env);
        env.storage().instance().remove(&DataKey::SendsPaused);
        env.events().publish(
            (Symbol::new(&env, "sends_unpaused"),),
            (admin, env.ledger().sequence()),
        );
        Ok(())
    }

    /// Whether `send` is currently paused. Read by the backend status flag.
    pub fn is_send_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::SendsPaused)
            .unwrap_or(false)
    }

    // ── Migration ───────────────────────────────────────────────────────────────

    /// Admin and user: trim a user's asset list to [`GlobeWallet::MAX_ASSETS`] if it exceeds the bound.
    /// Returns the number of assets trimmed (0 if already within limit).
    ///
    /// Only the display list is trimmed. Spend limits and spend windows of
    /// trimmed assets are kept and keep being enforced (issue #178); one
    /// `("migration", "asset_untracked")` event with `(user, code, limit)`
    /// is emitted per trimmed asset.
    ///
    /// # Authorization Decision
    /// Dual authorization is required: `admin.require_auth()` ensures only an
    /// administrator can initiate a migration, while `user.require_auth()`
    /// preserves the self-sovereign property of the wallet by ensuring the
    /// user consents to the exact asset list modification taking place.
    pub fn migrate_user_assets(env: Env, admin: Address, user: Address) -> Result<u32, WalletError> {
        admin.require_auth();
        user.require_auth();
        Self::require_admin(&env, &admin)?;
        let assets: Vec<AssetInfo> = env
            .storage()
            .persistent()
            .get(&DataKey::UserAssets(user.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        let len = assets.len();
        if len <= Self::MAX_ASSETS {
            return Ok(0);
        }
        Self::bump_instance_ttl(&env);
        let mut trimmed: Vec<AssetInfo> = Vec::new(&env);
        for i in 0..Self::MAX_ASSETS {
            trimmed.push_back(assets.get(i).unwrap());
        }
        // Issue #178: spend limits are keyed by (user, token) and are
        // independent of the display list. Trimming the list must never
        // delete a limit or its spend window — a missing limit means
        // "unlimited" and the token stays sendable. Every trimmed asset gets
        // an event (with the limit that stays in force) so the backend can
        // tell the user which assets left their list.
        for i in Self::MAX_ASSETS..len {
            let dropped = assets.get(i).unwrap();
            env.events().publish(
                (Symbol::new(&env, "migration"), Symbol::new(&env, "asset_untracked")),
                (user.clone(), dropped.code.clone()),
            );
        }
        env.storage()
            .persistent()
            .set(&DataKey::UserAssets(user.clone()), &trimmed);
        env.storage().persistent().extend_ttl(
            &DataKey::UserAssets(user.clone()),
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );
        let removed = len - Self::MAX_ASSETS;
        emit_event(&env, "user_assets_migrated", (user, removed),
        );
        Ok(removed)
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Compare two asset codes for equality, case-insensitively (ASCII
    /// upper-casing only — asset codes are conventionally ASCII alphanumeric).
    /// Used by `add_asset` to reject case-variant duplicates (e.g. "USDC" vs
    /// "usdc") per issue #29, while storage still preserves the caller's
    /// original casing.
    ///
    /// Codes longer than `MAX_ASSET_CODE_LEN` (which `add_asset` never
    /// allows to be newly registered, but could in principle already exist
    /// in storage from before this validation was added) fall back to exact
    /// `String` equality rather than risking a buffer-size mismatch.
    fn codes_match_case_insensitive(a: &String, b: &String) -> bool {
        if a.len() != b.len() {
            return false;
        }
        let len = a.len();
        if len == 0 {
            return true;
        }
        if len > Self::MAX_ASSET_CODE_LEN {
            return a == b;
        }
        let len = len as usize;
        let mut buf_a = [0u8; Self::MAX_ASSET_CODE_LEN as usize];
        let mut buf_b = [0u8; Self::MAX_ASSET_CODE_LEN as usize];
        a.copy_into_slice(&mut buf_a[..len]);
        b.copy_into_slice(&mut buf_b[..len]);
        for byte in buf_a[..len].iter_mut() {
            if byte.is_ascii_lowercase() {
                *byte = byte.to_ascii_uppercase();
            }
        }
        for byte in buf_b[..len].iter_mut() {
            if byte.is_ascii_lowercase() {
                *byte = byte.to_ascii_uppercase();
            }
        }
        buf_a[..len] == buf_b[..len]
    }

    /// Bump this contract's own *instance* storage TTL (`Admin`, `Guardians`,
    /// `RecoveryConfig`, every `PendingAdmin(...)`/`PendingUpgrade`/
    /// `RecoveryProposal` entry — everything that isn't per-user
    /// `.persistent()` state) forward by the same window `UserAssets`/
    /// `SpendLimit`/`DailySpent` already get via `PERSISTENT_TTL_THRESHOLD`/
    /// `PERSISTENT_TTL_EXTEND_TO`.
    ///
    /// **Found and fixed while getting `cargo test --workspace` running for
    /// issue #91** (see also `test_user_assets_ttl_extension_after_long_idle_period`
    /// and `test_spend_limit_ttl_extension_after_long_idle_period`, which
    /// were themselves already failing — not from anything about issue #91,
    /// but because this exact gap let *instance* storage archive out from
    /// under them mid-test): before this fix, not one function in this
    /// contract ever extended the TTL of its own instance storage. Every
    /// per-user entry (`UserAssets`, `SpendLimit`, `DailySpent`) was
    /// carefully protected against silent archival; the contract's own core
    /// state — `Admin`, the entire guardian/recovery subsystem, every
    /// pending proposal — was not. A wallet that goes quiet for longer than
    /// the network's default instance-entry lifetime (observably as little
    /// as `min_persistent_entry_ttl`, a few thousand ledgers — well under a
    /// day at Stellar's ~5s average close time, per the test environment's
    /// own default) would have its instance archived, and *every* function
    /// on the contract — including `admin()`, `guardians()`, and
    /// `execute_recovery` itself, the one function specifically meant to
    /// still work when almost nothing else does — would fail until someone
    /// pays for an explicit, separate restore operation. This is a strictly
    /// worse failure mode than anything the guardian-recovery subsystem
    /// defends against: a wallet doesn't need a compromised or lost admin
    /// key to become unusable, it just needs to be left alone long enough.
    ///
    /// Called at the start of every state-mutating function (after
    /// authorization, so an unauthorized caller can't spend the contract's
    /// budget triggering it) — cheap and idempotent: `extend_ttl` is a
    /// no-op whenever the entry's current TTL already exceeds `threshold`,
    /// so calling this on every write only ever *shortens* the average gap
    /// since the last bump, never adds meaningful overhead to a wallet
    /// that's already being used normally.
    fn bump_instance_ttl(env: &Env) {
        env.storage().instance().extend_ttl(
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), WalletError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(WalletError::NotInitialized)?;
        if &admin != caller {
            return Err(WalletError::Unauthorized);
        }
        Ok(())
    }

    /// Admin, or an explicit holder of `role` (issue #190).
    fn require_role(env: &Env, caller: &Address, role: Role) -> Result<(), WalletError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(WalletError::NotInitialized)?;
        if &admin == caller {
            return Ok(());
        }
        if env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::RoleMember(role, caller.clone()))
            .unwrap_or(false)
        {
            return Ok(());
        }
        Err(WalletError::Unauthorized)
    }

    fn set_paused(env: &Env, caller: Address, paused: bool) -> Result<(), WalletError> {
        caller.require_auth();
        Self::require_role(env, &caller, Role::Pauser)?;
        Self::bump_instance_ttl(env);
        env.storage().instance().set(&DataKey::Paused, &paused);
        emit_event(
            env,
            "pause_changed",
            PauseChangedEvent {
                paused,
                changed_by: caller,
            },
        );
        Ok(())
    }

    /// Build the XDR `Asset` for a classic asset (issue #189).
    ///
    /// * `issuer_key == None` — must be native XLM: `ASSET_TYPE_NATIVE` (0).
    /// * code of 1-4 chars — `ASSET_TYPE_CREDIT_ALPHANUM4` (1), code padded to 4.
    /// * code of 5-12 chars — `ASSET_TYPE_CREDIT_ALPHANUM12` (2), padded to 12.
    ///
    /// Issuer is encoded as `PUBLIC_KEY_TYPE_ED25519` (0) + the 32-byte key.
    fn stellar_asset_xdr(
        env: &Env,
        asset_code: &String,
        issuer_key: &Option<BytesN<32>>,
    ) -> Result<Bytes, WalletError> {
        let len = asset_code.len() as usize;
        if len == 0 || len > Self::MAX_ASSET_CODE_LEN as usize {
            return Err(WalletError::InvalidAssetCode);
        }
        let mut code = [0u8; 12];
        asset_code.copy_into_slice(&mut code[..len]);
        for b in code[..len].iter() {
            if !b.is_ascii_alphanumeric() {
                return Err(WalletError::InvalidAssetCode);
            }
        }
        match issuer_key {
            None => {
                if &code[..len] != b"XLM" {
                    return Err(WalletError::InvalidAssetInfo);
                }
                Ok(Bytes::from_array(env, &[0, 0, 0, 0]))
            }
            Some(key) => {
                let (asset_type, width) = if len <= 4 { (1u8, 4usize) } else { (2u8, 12usize) };
                let mut out = Bytes::from_array(env, &[0, 0, 0, asset_type]);
                out.extend_from_slice(&code[..width]);
                out.extend_from_array(&[0, 0, 0, 0]);
                out.extend_from_array(&key.to_array());
                Ok(out)
            }
        }
    }

    /// The contract address the network assigns to the SAC of this asset.
    fn derive_sac_address(
        env: &Env,
        asset_code: &String,
        issuer_key: &Option<BytesN<32>>,
    ) -> Result<Address, WalletError> {
        let xdr = Self::stellar_asset_xdr(env, asset_code, issuer_key)?;
        Ok(env.deployer().with_stellar_asset(xdr).deployed_address())
    }

    fn require_guardian(env: &Env, caller: &Address) -> Result<(), WalletError> {
        if Self::is_guardian(env, caller) {
            return Ok(());
        }
        Err(WalletError::Unauthorized)
    }

    // ── Storage layout v2 helpers (issue #184) ───────────────────────────────

    /// O(1) membership check: one small persistent entry per guardian on v2;
    /// falls back to the legacy instance map/vector on an unmigrated v1
    /// contract.
    fn is_guardian(env: &Env, who: &Address) -> bool {
        let key = DataKey::GuardianFlag(who.clone());
        if env.storage().persistent().has(&key) {
            return true;
        }
        if Self::storage_layout(env.clone()) >= STORAGE_LAYOUT_VERSION {
            return false;
        }
        let legacy: Option<Map<Address, bool>> =
            env.storage().instance().get(&DataKey::GuardianMembership);
        if let Some(map) = legacy {
            return map.get(who.clone()).unwrap_or(false);
        }
        Self::guardians(env.clone()).contains(who)
    }

    fn set_guardian_flag(env: &Env, who: &Address) {
        let key = DataKey::GuardianFlag(who.clone());
        env.storage().persistent().set(&key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
    }

    fn store_guardians(env: &Env, guardians: &Vec<Address>) {
        env.storage().persistent().set(&DataKey::GuardianSet, guardians);
        env.storage().persistent().extend_ttl(
            &DataKey::GuardianSet,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );
    }

    fn store_proposal(env: &Env, proposal: &RecoveryProposal) {
        env.storage()
            .persistent()
            .set(&DataKey::PendingRecovery, proposal);
        env.storage().persistent().extend_ttl(
            &DataKey::PendingRecovery,
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL_EXTEND_TO,
        );
    }

    fn remove_proposal(env: &Env) {
        env.storage().persistent().remove(&DataKey::PendingRecovery);
        env.storage().instance().remove(&DataKey::RecoveryProposal);
    }

    /// Move v1 instance entries to their v2 persistent keys. Idempotent;
    /// returns `true` only when it actually migrated. Semantics-preserving,
    /// so it needs no extra authorization beyond the caller's own path.
    fn ensure_storage_layout(env: &Env) -> bool {
        if Self::storage_layout(env.clone()) >= STORAGE_LAYOUT_VERSION {
            return false;
        }
        let instance = env.storage().instance();
        let legacy_guardians: Option<Vec<Address>> = instance.get(&DataKey::Guardians);
        let mut moved_guardians: u32 = 0;
        if let Some(guardians) = legacy_guardians {
            for g in guardians.iter() {
                Self::set_guardian_flag(env, &g);
            }
            moved_guardians = guardians.len();
            Self::store_guardians(env, &guardians);
        }
        let legacy_proposal: Option<RecoveryProposal> = instance.get(&DataKey::RecoveryProposal);
        let moved_proposal = legacy_proposal.is_some();
        if let Some(p) = legacy_proposal {
            Self::store_proposal(env, &p);
        }
        instance.remove(&DataKey::Guardians);
        instance.remove(&DataKey::GuardianMembership);
        instance.remove(&DataKey::RecoveryProposal);
        instance.set(&DataKey::StorageLayout, &STORAGE_LAYOUT_VERSION);
        env.events().publish(
            (Symbol::new(env, "storage_migrated"),),
            (STORAGE_LAYOUT_VERSION, moved_guardians, moved_proposal),
        );
        true
    }

    fn require_recovery_configured(env: &Env) -> Result<RecoveryConfig, WalletError> {
        env.storage()
            .instance()
            .get(&DataKey::RecoveryConfig)
            .ok_or(WalletError::RecoveryNotConfigured)
    }

    fn require_pending_recovery(env: &Env) -> Result<RecoveryProposal, WalletError> {
        Self::recovery_proposal(env.clone()).ok_or(WalletError::NoPendingRecovery)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events as _, Ledger as _},
        Env, String, BytesN, Address, TryFromVal, Val,
    };

    /// soroban-sdk 22+ hands test events back as XDR (`ContractEvents`);
    /// convert them to the `(contract, topics, data)` Val tuples the event
    /// assertions in this module are written against.
    fn all_events(env: &Env) -> std::vec::Vec<(Address, soroban_sdk::Vec<Val>, Val)> {
        use soroban_sdk::xdr;
        env.events()
            .all()
            .events()
            .iter()
            .filter_map(|e| {
                let xdr::ContractEventBody::V0(body) = &e.body;
                let contract = Address::try_from_val(
                    env,
                    &xdr::ScVal::Address(xdr::ScAddress::Contract(e.contract_id.clone()?)),
                )
                .ok()?;
                let mut topics = soroban_sdk::Vec::new(env);
                for t in body.topics.iter() {
                    topics.push_back(Val::try_from_val(env, t).ok()?);
                }
                let data = Val::try_from_val(env, &body.data).ok()?;
                Some((contract, topics, data))
            })
            .collect()
    }

    fn make_code(env: &Env, n: u32) -> String {
        String::from_str(env, &std::format!("A{:02}", n))
    }

    fn fill_to_max(env: &Env, client: &GlobeWalletClient, user: &Address) {
        for i in 0..GlobeWallet::MAX_ASSETS {
            let code = make_code(env, i);
            let asset = AssetInfo { code, issuer: Some(Address::generate(env)) };
            client.add_asset(user, &asset);
        }
    }

    fn setup() -> (Env, Address, Address, GlobeWalletClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GlobeWallet);
        let client = GlobeWalletClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, id, admin, client)
    }

    fn xlm(env: &Env) -> AssetInfo {
        AssetInfo {
            code: String::from_str(env, "XLM"),
            issuer: None,
        }
    }

    fn usdc(env: &Env) -> AssetInfo {
        AssetInfo {
            code: String::from_str(env, "USDC"),
            issuer: Some(Address::generate(env)),
        }
    }

    #[test]
    fn test_initialize() {
        let (_env, _cid, admin, client) = setup();
        assert_eq!(client.admin(), admin);
    }

    #[test]
    fn test_initialize_twice_fails() {
        let (_env, _cid, admin, client) = setup();
        assert_eq!(
            client.try_initialize(&admin),
            Err(Ok(WalletError::AlreadyInitialized))
        );
    }

    #[test]
    fn test_add_and_get_assets() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        client.add_asset(&user, &xlm(&env));
        client.add_asset(&user, &usdc(&env));
        let assets = client.get_assets(&user);
        assert_eq!(assets.len(), 2);
        assert_eq!(assets.get(0).unwrap().code, String::from_str(&env, "XLM"));
    }

    #[test]
    fn test_add_duplicate_asset_fails() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        client.add_asset(&user, &xlm(&env));
        assert_eq!(
            client.try_add_asset(&user, &xlm(&env)),
            Err(Ok(WalletError::AssetAlreadyAdded))
        );
    }

    #[test]
    fn test_add_asset_empty_code_fails() {
        // issue #29: an empty asset code must be rejected outright.
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let empty = AssetInfo {
            code: String::from_str(&env, ""),
            issuer: Some(Address::generate(&env)),
        };
        assert_eq!(
            client.try_add_asset(&user, &empty),
            Err(Ok(WalletError::InvalidAssetCode))
        );
    }

    #[test]
    fn test_add_asset_overlong_code_fails() {
        // issue #29: codes longer than MAX_ASSET_CODE_LEN (12) must be rejected.
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let overlong = AssetInfo {
            code: String::from_str(&env, "THIRTEENCHARS"), // 13 chars
            issuer: Some(Address::generate(&env)),
        };
        assert_eq!(
            client.try_add_asset(&user, &overlong),
            Err(Ok(WalletError::InvalidAssetCode))
        );
    }

    #[test]
    fn test_add_asset_case_variant_duplicate_fails() {
        // issue #29: "USDC" and "usdc" must be treated as the same asset.
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        client.add_asset(&user, &usdc(&env)); // "USDC"
        let lower = AssetInfo {
            code: String::from_str(&env, "usdc"),
            issuer: Some(Address::generate(&env)),
        };
        assert_eq!(
            client.try_add_asset(&user, &lower),
            Err(Ok(WalletError::AssetAlreadyAdded))
        );
        // Only one entry should exist.
        assert_eq!(client.get_assets(&user).len(), 1);
    }

    #[test]
    fn test_remove_asset() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        client.add_asset(&user, &xlm(&env));
        client.add_asset(&user, &usdc(&env));
        client.remove_asset(&user, &String::from_str(&env, "XLM"));
        let assets = client.get_assets(&user);
        assert_eq!(assets.len(), 1);
        assert_eq!(assets.get(0).unwrap().code, String::from_str(&env, "USDC"));
    }

    #[test]
    fn test_remove_nonexistent_asset_fails() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        assert_eq!(
            client.try_remove_asset(&user, &String::from_str(&env, "XLM")),
            Err(Ok(WalletError::AssetNotFound))
        );
    }

    #[test]
    fn test_spend_limit_set_and_get() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let _code = Address::generate(&env);
        let code_token = Address::generate(&env);
        client.set_spend_limit(&user, &code_token, &1_000_000_i128);
        assert_eq!(client.get_spend_limit(&user, &code_token), 1_000_000);
    }

    #[test]
    fn test_record_spend_within_limit() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let _code = Address::generate(&env);
        let code_token = Address::generate(&env);
        client.set_spend_limit(&user, &code_token, &1_000_000_i128);
        client.record_spend(&user, &code_token, &500_000_i128);
        client.record_spend(&user, &code_token, &499_999_i128);
    }

    #[test]
    fn test_record_spend_exceeds_limit_fails() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let _code = Address::generate(&env);
        let code_token = Address::generate(&env);
        client.set_spend_limit(&user, &code_token, &1_000_000_i128);
        client.record_spend(&user, &code_token, &999_999_i128);
        assert_eq!(
            client.try_record_spend(&user, &code_token, &2_i128),
            Err(Ok(WalletError::SpendLimitExceeded))
        );
    }

    #[test]
    fn test_record_spend_negative_amount_fails() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let _code = Address::generate(&env);
        let code_token = Address::generate(&env);
        client.set_spend_limit(&user, &code_token, &1_000_000_i128);
        assert_eq!(
            client.try_record_spend(&user, &code_token, &(-1_i128)),
            Err(Ok(WalletError::InvalidSpendLimit))
        );
    }

    #[test]
    fn test_record_spend_zero_amount_fails() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let _code = Address::generate(&env);
        let code_token = Address::generate(&env);
        client.set_spend_limit(&user, &code_token, &1_000_000_i128);
        assert_eq!(
            client.try_record_spend(&user, &code_token, &0_i128),
            Err(Ok(WalletError::InvalidSpendLimit))
        );
    }

    #[test]
    fn test_record_spend_rejected_negative_amount_does_not_mutate_state() {
        // A rejected call must not perturb `spent_today` at all — confirms
        // the validation short-circuits before any storage write, not just
        // before the limit comparison.
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let _code = Address::generate(&env);
        let code_token = Address::generate(&env);
        client.set_spend_limit(&user, &code_token, &1_000_000_i128);
        client.record_spend(&user, &code_token, &900_000_i128);

        assert_eq!(
            client.try_record_spend(&user, &code_token, &(-900_000_i128)),
            Err(Ok(WalletError::InvalidSpendLimit))
        );

        // spent_today must still be exactly 900_000, leaving exactly 100_000
        // of headroom against the 1_000_000 limit. One unit over that
        // headroom must be rejected...
        assert_eq!(
            client.try_record_spend(&user, &code_token, &100_001_i128),
            Err(Ok(WalletError::SpendLimitExceeded))
        );
        // ...while spending exactly the remaining headroom must succeed,
        // proving spent_today was neither reset nor left in some other
        // corrupted value by the rejected negative-amount call.
        client.record_spend(&user, &code_token, &100_000_i128);
    }

    #[test]
    fn test_record_spend_negative_amount_cannot_bypass_daily_limit() {
        // Reproduction of the exact attack in issue #25: reset spent_today
        // to (near) zero with a negative call, then spend again past what
        // the configured limit was supposed to allow for the day.
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let _code = Address::generate(&env);
        let code_token = Address::generate(&env);
        client.set_spend_limit(&user, &code_token, &1_000_000_i128);
        client.record_spend(&user, &code_token, &900_000_i128);

        // Attempted reset via negative amount must be rejected outright...
        assert_eq!(
            client.try_record_spend(&user, &code_token, &(-900_000_i128)),
            Err(Ok(WalletError::InvalidSpendLimit))
        );

        // ...so the follow-up spend that the attack depended on is still
        // bound by the *original*, un-reset spent_today (900_000), and a
        // further 999_999 remains correctly rejected as exceeding the
        // 1_000_000 daily limit.
        assert_eq!(
            client.try_record_spend(&user, &code_token, &999_999_i128),
            Err(Ok(WalletError::SpendLimitExceeded))
        );
    }

    #[test]
    fn test_record_spend_overflow_does_not_poison_later_calls() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let _code = Address::generate(&env);
        let code_token = Address::generate(&env);
        client.set_spend_limit(&user, &code_token, &i128::MAX);

        client.record_spend(&user, &code_token, &1_i128);

        assert_eq!(
            client.try_record_spend(&user, &code_token, &i128::MAX),
            Err(Ok(WalletError::SpendOverflow))
        );

        client.record_spend(&user, &code_token, &1_i128);
    }

    #[test]
    fn test_no_limit_allows_any_spend() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let _code = Address::generate(&env);
        let code_token = Address::generate(&env);
        // No set_spend_limit call → unlimited
        client.record_spend(&user, &code_token, &i128::MAX);
    }

    /// Retroactive enforcement: raise limit → spend near it → lower limit
    /// below already-spent amount → must be rejected.
    #[test]
    fn test_raise_spend_then_lower_limit() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let code = Address::generate(&env);
        let code_token = Address::generate(&env);

        // 1. Set a high limit
        client.set_spend_limit(&user, &code_token, &1_000_000_i128);

        // 2. Spend close to the high limit
        client.record_spend(&user, &code_token, &900_000_i128);

        // 3. Try to lower the limit below what was already spent → must fail
        assert_eq!(
            client.try_set_spend_limit(&user, &code_token, &500_000_i128),
            Err(Ok(WalletError::SpendLimitExceeded))
        );

        // 4. The old limit should still be in effect
        assert_eq!(client.get_spend_limit(&user, &code_token), 1_000_000);

        // 5. Lowering to exactly the spent amount should succeed
        client.set_spend_limit(&user, &code_token, &900_000_i128);
        assert_eq!(client.get_spend_limit(&user, &code_token), 900_000);

        // 6. Further spending is now blocked (at the exact limit)
        assert_eq!(
            client.try_record_spend(&user, &code_token, &1_i128),
            Err(Ok(WalletError::SpendLimitExceeded))
        );

        // 7. Removing the limit (0 = unlimited) is an increase (#176): it is
        //    queued and only takes effect after the delay.
        client.set_spend_limit(&user, &code_token, &0_i128);
        assert_eq!(client.get_spend_limit(&user, &code_token), 900_000);
        assert!(client.pending_spend_limit(&user, &code_token).is_some());
        env.ledger()
            .with_mut(|l| l.timestamp += SPEND_LIMIT_INCREASE_DELAY_SECS);
        assert_eq!(client.get_spend_limit(&user, &code_token), 0);
    }

    #[test]
    fn test_send_charges_limit_of_token_actually_moved() {
        // #173 regression: there is no caller-chosen asset code any more, so
        // a USDC send is always charged against the USDC limit — the old
        // bypass (pass "XLM" with no limit while moving USDC) is gone.
        let (env, wallet_id, admin, client) = setup();
        let wrapper_id = env.register_contract(None, token_wrapper::TokenWrapper);
        let wrapper_client = token_wrapper::TokenWrapperClient::new(&env, &wrapper_id);
        client.set_token_wrapper(&admin, &wrapper_id);
        let token_admin = Address::generate(&env);
        let (usdc, usdc_admin, usdc_token) = create_allowed_token(&env, &client, &admin, &token_admin);
        let xlm_like = Address::generate(&env); // an unlimited, unrelated token id
        let user = Address::generate(&env);
        let to = Address::generate(&env);
        usdc_admin.mint(&user, &10_000);
        client.set_spend_limit(&user, &usdc, &300_i128);
        assert_eq!(client.get_spend_limit(&user, &xlm_like), 0);

        env.ledger().with_mut(|l| l.sequence_number = 100);
        wrapper_client.approve(&user, &wallet_id, &usdc, &10_000, &10_000, &None);
        client.send(&user, &usdc, &to, &200);
        assert_eq!(
            client.try_send(&user, &usdc, &to, &200),
            Err(Ok(WalletError::SpendLimitExceeded))
        );
        assert_eq!(usdc_token.balance(&to), 200);
        assert_eq!(client.get_spent_today(&user, &usdc), 200);
    }

    #[test]
    fn test_migrate_spend_limit_preserves_legacy_limit_and_spent() {
        // #173: legacy `SpendLimit(user, code)` entries move to the
        // token-keyed form without losing the limit or today's spend.
        let (env, cid, admin, client) = setup();
        let user = Address::generate(&env);
        let token = Address::generate(&env);
        let code = String::from_str(&env, "USDC");
        env.as_contract(&cid, || {
            env.storage()
                .persistent()
                .set(&DataKey::SpendLimit(user.clone(), code.clone()), &1_000_i128);
            env.storage().persistent().set(
                &DataKey::DailySpent(user.clone(), code.clone()),
                &SpendRecord { amount: 400, day: env.ledger().timestamp() / SECONDS_PER_DAY },
            );
        });
        assert_eq!(client.get_spend_limit(&user, &token), 0);

        assert!(client.migrate_spend_limit(&admin, &user, &code, &token));
        assert_eq!(client.get_spend_limit(&user, &token), 1_000);
        assert_eq!(client.get_spent_today(&user, &token), 400);
        assert_eq!(
            client.try_record_spend(&user, &token, &601_i128),
            Err(Ok(WalletError::SpendLimitExceeded))
        );
        env.as_contract(&cid, || {
            assert!(!env.storage().persistent().has(&DataKey::SpendLimit(user.clone(), code.clone())));
            assert!(!env.storage().persistent().has(&DataKey::DailySpent(user.clone(), code.clone())));
        });
        // Idempotent: nothing left to migrate.
        assert!(!client.migrate_spend_limit(&admin, &user, &code, &token));
    }

    #[test]
    fn test_migrate_spend_limit_keeps_stricter_limit_and_requires_admin() {
        let (env, cid, admin, client) = setup();
        let user = Address::generate(&env);
        let token = Address::generate(&env);
        let code = String::from_str(&env, "USDC");
        env.as_contract(&cid, || {
            env.storage()
                .persistent()
                .set(&DataKey::SpendLimit(user.clone(), code.clone()), &5_000_i128);
        });
        client.set_spend_limit(&user, &token, &1_000_i128);
        assert_eq!(
            client.try_migrate_spend_limit(&Address::generate(&env), &user, &code, &token),
            Err(Ok(WalletError::Unauthorized))
        );
        client.migrate_spend_limit(&admin, &user, &code, &token);
        assert_eq!(client.get_spend_limit(&user, &token), 1_000);
    }

    #[test]
    fn test_spend_limit_increase_is_delayed() {
        // #176: raising the limit queues it; spends above the old limit stay
        // rejected until the delay elapses.
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let token = Address::generate(&env);
        client.set_spend_limit(&user, &token, &100_i128);
        client.set_spend_limit(&user, &token, &10_000_i128);
        assert!(find_event(&env, "spend_limit_increase_pending").is_some());

        assert_eq!(client.get_spend_limit(&user, &token), 100);
        let pending = client.pending_spend_limit(&user, &token).unwrap();
        assert_eq!(pending.limit, 10_000);
        assert_eq!(
            pending.effective_at,
            env.ledger().timestamp() + SPEND_LIMIT_INCREASE_DELAY_SECS
        );
        assert_eq!(
            client.try_record_spend(&user, &token, &101_i128),
            Err(Ok(WalletError::SpendLimitExceeded))
        );

        env.ledger()
            .with_mut(|l| l.timestamp += SPEND_LIMIT_INCREASE_DELAY_SECS);
        assert_eq!(client.get_spend_limit(&user, &token), 10_000);
        client.record_spend(&user, &token, &5_000_i128);
        assert!(client.pending_spend_limit(&user, &token).is_none());
    }

    #[test]
    fn test_switch_to_unlimited_is_delayed() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let token = Address::generate(&env);
        client.set_spend_limit(&user, &token, &100_i128);
        client.set_spend_limit(&user, &token, &0_i128);
        assert_eq!(client.get_spend_limit(&user, &token), 100);
        assert_eq!(
            client.try_record_spend(&user, &token, &1_000_i128),
            Err(Ok(WalletError::SpendLimitExceeded))
        );
    }

    #[test]
    fn test_spend_limit_decrease_is_immediate_and_drops_pending_increase() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let token = Address::generate(&env);
        client.set_spend_limit(&user, &token, &1_000_i128);
        client.set_spend_limit(&user, &token, &5_000_i128); // queued
        client.set_spend_limit(&user, &token, &500_i128); // immediate
        assert_eq!(client.get_spend_limit(&user, &token), 500);
        assert!(client.pending_spend_limit(&user, &token).is_none());
        env.ledger()
            .with_mut(|l| l.timestamp += SPEND_LIMIT_INCREASE_DELAY_SECS);
        assert_eq!(client.get_spend_limit(&user, &token), 500);
    }

    #[test]
    fn test_cancel_pending_spend_limit_by_owner_and_guardian() {
        let (env, _admin, guardians, client) = setup_with_guardians(3);
        let user = Address::generate(&env);
        let token = Address::generate(&env);
        client.set_spend_limit(&user, &token, &100_i128);

        client.set_spend_limit(&user, &token, &1_000_i128);
        client.cancel_pending_spend_limit(&user, &user, &token);
        assert!(find_event(&env, "spend_limit_increase_cancelled").is_some());
        assert!(client.pending_spend_limit(&user, &token).is_none());

        client.set_spend_limit(&user, &token, &1_000_i128);
        client.cancel_pending_spend_limit(&guardians.get(0).unwrap(), &user, &token);
        env.ledger()
            .with_mut(|l| l.timestamp += SPEND_LIMIT_INCREASE_DELAY_SECS);
        assert_eq!(client.get_spend_limit(&user, &token), 100);
    }

    #[test]
    fn test_cancel_pending_spend_limit_rejects_stranger_and_missing() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let token = Address::generate(&env);
        assert_eq!(
            client.try_cancel_pending_spend_limit(&user, &user, &token),
            Err(Ok(WalletError::NoPendingSpendLimit))
        );
        client.set_spend_limit(&user, &token, &100_i128);
        client.set_spend_limit(&user, &token, &1_000_i128);
        assert_eq!(
            client.try_cancel_pending_spend_limit(&Address::generate(&env), &user, &token),
            Err(Ok(WalletError::Unauthorized))
        );
        assert!(client.pending_spend_limit(&user, &token).is_some());
    }

    #[test]
    fn test_transfer_admin() {
        let (env, _cid, admin, client) = setup();
        let new_admin = Address::generate(&env);
        client.transfer_admin(&admin, &new_admin);
        assert_eq!(client.admin(), admin);
        client.propose_admin(&admin, &new_admin);
        client.accept_admin(&new_admin);
        assert_eq!(client.admin(), new_admin);
    }

    #[test]
    fn test_daily_spent_survives_temporary_ttl_eviction() {
        // Regression test: DailySpent must live in *persistent* storage so an
        // unrelated temporary-storage archival pass can never reset a user's
        // spend counter before the real 86_400s day window elapses.
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let _code = Address::generate(&env);
        let code_token = Address::generate(&env);
        client.set_spend_limit(&user, &code_token, &1_000_000_i128);
        client.record_spend(&user, &code_token, &900_000_i128);

        // Simulate an eviction sweep of *temporary* storage only (persistent
        // entries are untouched) by bumping the ledger sequence far past the
        // test env's default temporary-entry TTL (16 ledgers) while staying
        // well under the default persistent-entry TTL (4096 ledgers), so the
        // contract instance itself is not archived — only DailySpent's old
        // (temporary-storage) TTL would have expired at this point.
        env.ledger().with_mut(|l| l.sequence_number += 3_000);

        // If DailySpent were still in temporary storage this would have been
        // archived/reset to 0 and the next 200_000 spend would wrongly succeed.
        assert_eq!(
            client.try_record_spend(&user, &code_token, &200_000_i128),
            Err(Ok(WalletError::SpendLimitExceeded))
        );
    }

    #[test]
    fn test_require_admin_not_initialized() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GlobeWallet);
        let client = GlobeWalletClient::new(&env, &id);
        let caller = Address::generate(&env);
        assert_eq!(
            client.try_transfer_admin(&caller, &caller),
            Err(Ok(WalletError::NotInitialized))
        );
    }

    #[test]
    fn test_propose_without_accept_keeps_admin_unchanged() {
        let (env, _cid, admin, client) = setup();
        let new_admin = Address::generate(&env);
        client.propose_admin(&admin, &new_admin);
        assert_eq!(client.admin(), admin);
    }

    #[test]
    fn test_accept_by_wrong_address_fails() {
        let (env, _cid, admin, client) = setup();
        let candidate = Address::generate(&env);
        let wrong = Address::generate(&env);
        client.propose_admin(&admin, &candidate);
        assert_eq!(
            client.try_accept_admin(&wrong),
            Err(Ok(WalletError::Unauthorized))
        );
        assert_eq!(client.admin(), admin);
    }

    #[test]
    fn test_cancel_admin_transfer() {
        let (env, _cid, admin, client) = setup();
        let candidate = Address::generate(&env);
        client.propose_admin(&admin, &candidate);
        client.cancel_admin_transfer(&admin);
        assert_eq!(client.admin(), admin);
        assert_eq!(
            client.try_accept_admin(&candidate),
            Err(Ok(WalletError::NoPendingAdmin))
        );
    }

    #[test]
    fn test_max_assets_limit() {
        // Pre-existing test bug found while getting `cargo test --workspace`
        // running for issue #91: this test predates issue #29's requirement
        // that a non-native asset (any code other than exactly "XLM") must
        // carry a real issuer. It was registering 50 issuer-less assets and
        // relying on the *last* one to fail with `AssetLimitExceeded` — but
        // since #29 landed, the *first* one now fails with
        // `InvalidAssetInfo` instead, for a completely different reason
        // than the one this test exists to cover. Fixed by reusing the
        // existing `fill_to_max` helper, which already gives each asset a
        // real issuer — this was actually what it exists for; the test had
        // simply drifted onto its own inline (and since-broken) copy of the
        // same loop instead of calling it.
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        fill_to_max(&env, &client, &user);
        let extra = AssetInfo {
            code: String::from_str(&env, "EXTRA"),
            issuer: Some(Address::generate(&env)),
        };
        assert_eq!(
            client.try_add_asset(&user, &extra),
            Err(Ok(WalletError::AssetLimitExceeded))
        );
    }

    #[test]
    fn test_migrate_user_assets_trims_excess() {
        let (env, cid, admin, client) = setup();
        let user = Address::generate(&env);
        let mut assets: Vec<AssetInfo> = Vec::new(&env);
        for i in 0..GlobeWallet::MAX_ASSETS + 10 {
            let code = String::from_str(&env, &std::format!("ASSET{}", i));
            assets.push_back(AssetInfo { code: code.clone(), issuer: None });
        }
        env.as_contract(&cid, || {
            env.storage()
                .persistent()
                .set(&DataKey::UserAssets(user.clone()), &assets);
                
            // Set up some spend limits and daily spent records for all assets
            for i in 0..GlobeWallet::MAX_ASSETS + 10 {
                let code = String::from_str(&env, &std::format!("ASSET{}", i));
                env.storage().persistent().set(&DataKey::SpendLimit(user.clone(), code.clone()), &1000_i128);
                env.storage().persistent().set(&DataKey::DailySpent(user.clone(), code.clone()), &SpendRecord { amount: 500, day: 0 });
            }
        });
        let removed = client.migrate_user_assets(&admin, &user);
        assert_eq!(removed, 10);
        let migration_events = all_events(&env)
            .iter()
            .filter(|(_, topics, _)| {
                topics
                    .first()
                    .and_then(|t| Symbol::try_from_val(&env, &t).ok())
                    .map(|s| s == Symbol::new(&env, "migration"))
                    .unwrap_or(false)
            })
            .count();
        assert_eq!(migration_events, 10, "one event per trimmed asset");
        let assets = client.get_assets(&user);
        assert_eq!(assets.len(), GlobeWallet::MAX_ASSETS as u32);
        

        env.as_contract(&cid, || {
            // Issue #178: limits and spend records are kept for every asset,
            // trimmed or not.
            for i in 0..GlobeWallet::MAX_ASSETS + 10 {
                let code = String::from_str(&env, &std::format!("ASSET{}", i));
                assert!(env.storage().persistent().has(&DataKey::SpendLimit(user.clone(), code.clone())));
                assert!(env.storage().persistent().has(&DataKey::DailySpent(user.clone(), code.clone())));
            }
        });

        // Every previously limited token still enforces its limit.
        for i in 0..GlobeWallet::MAX_ASSETS + 10 {
            let _code = String::from_str(&env, &std::format!("ASSET{}", i));
            let code_token = Address::generate(&env);
            assert_eq!(client.get_spend_limit(&user, &code_token), 1000);
            assert_eq!(
                client.try_record_spend(&user, &code_token, &1001_i128),
                Err(Ok(WalletError::SpendLimitExceeded))
            );
        }
    }

    #[test]
    fn test_migrate_user_assets_keeps_spend_window_of_trimmed_asset() {
        let (env, cid, admin, client) = setup();
        let user = Address::generate(&env);
        let mut assets: Vec<AssetInfo> = Vec::new(&env);
        for i in 0..GlobeWallet::MAX_ASSETS + 1 {
            let code = String::from_str(&env, &std::format!("ASSET{}", i));
            assets.push_back(AssetInfo { code, issuer: None });
        }
        env.as_contract(&cid, || {
            env.storage().persistent().set(&DataKey::UserAssets(user.clone()), &assets);
        });
        let trimmed = String::from_str(&env, &std::format!("ASSET{}", GlobeWallet::MAX_ASSETS));
        let trimmed_token = Address::generate(&env);
        client.set_spend_limit(&user, &trimmed_token, &1_000_i128);
        client.record_spend(&user, &trimmed_token, &700_i128);

        assert_eq!(client.migrate_user_assets(&admin, &user), 1);
        assert!(!client.get_assets(&user).iter().any(|a| a.code == trimmed));

        // Not reset to "unlimited" and the 700 already spent still counts.
        assert_eq!(client.get_spend_limit(&user, &trimmed_token), 1_000);
        assert_eq!(client.get_spent_today(&user, &trimmed_token), 700);
        assert_eq!(
            client.try_record_spend(&user, &trimmed_token, &301_i128),
            Err(Ok(WalletError::SpendLimitExceeded))
        );
    }

    #[test]
    fn test_migrate_user_assets_within_limit_does_nothing() {
        // Same pre-existing issue-#29 gap as `test_max_assets_limit` above:
        // a non-native asset needs a real issuer since #29 landed.
        let (env, _cid, admin, client) = setup();
        let user = Address::generate(&env);
        for i in 0..3 {
            let code = String::from_str(&env, &std::format!("ASSET{}", i));
            let asset = AssetInfo { code, issuer: Some(Address::generate(&env)) };
            client.add_asset(&user, &asset);
        }
        let removed = client.migrate_user_assets(&admin, &user);
        assert_eq!(removed, 0);
        let assets = client.get_assets(&user);
        assert_eq!(assets.len(), 3);
    }

    #[test]
    fn test_migrate_user_assets_requires_admin() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let non_admin = Address::generate(&env);
        assert_eq!(
            client.try_migrate_user_assets(&non_admin, &user),
            Err(Ok(WalletError::Unauthorized))
        );
    }

    #[test]
    #[should_panic]
    fn test_propose_and_execute_upgrade() {
        // issue #33: this test used to be `#[ignore]`d because it embedded a
        // real `globe_wallet.wasm` fixture via `include_bytes!` that was
        // never actually committed to the repo (`*.wasm` is gitignored, and
        // no such file exists anywhere in this crate's history) — so the
        // ignored test could never even have compiled, let alone run.
        //
        // Per the issue's own suggested fix, this exercises `execute_upgrade`
        // end-to-end (admin-gate → hash-match check → timelock check) using
        // the same no-real-WASM-needed technique the already-passing
        // `test_execute_upgrade_with_never_uploaded_hash_traps` uses below:
        // once every contract-level gate passes, execution reaches the
        // host-level `update_current_contract_wasm` call, which traps
        // because this placeholder hash was never registered via
        // `upload_contract_wasm`. That trap is the observable proof that
        // admin-gating, hash-matching, and the timelock were all correctly
        // satisfied first — the three invariants this test exists to cover.
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GlobeWallet);
        let client = GlobeWalletClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let user = Address::generate(&env);
        client.add_asset(&user, &xlm(&env));

        let wasm_hash = BytesN::from_array(&env, &[3u8; 32]);
        client.propose_upgrade(&admin, &wasm_hash, &GlobeWallet::MIN_UPGRADE_DELAY_LEDGERS);

        env.ledger()
            .set_sequence_number(GlobeWallet::MIN_UPGRADE_DELAY_LEDGERS);
        // Traps here (host-level), after all contract-level checks passed.
        client.execute_upgrade(&admin, &wasm_hash);
    }

    #[test]
    fn test_propose_upgrade_requires_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GlobeWallet);
        let client = GlobeWalletClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let non_admin = Address::generate(&env);
        let placeholder_hash = BytesN::from_array(&env, &[0u8; 32]); // no real WASM upload needed
        assert_eq!(
            client.try_propose_upgrade(&non_admin, &placeholder_hash, &0u32),
            Err(Ok(WalletError::Unauthorized))
        );
    }

    #[test]
    fn test_upgrade_requires_admin_and_ready_time() {
        // issue #33: previously `#[ignore]`d for the same reason as
        // `test_propose_and_execute_upgrade` above (a non-existent embedded
        // .wasm fixture). Both invariants this test covers — the admin gate
        // and the timelock — are checked by `execute_upgrade` *before* any
        // real WASM is touched (see the check order in `execute_upgrade`:
        // `require_admin` → hash-match → `ready_at` comparison → only then
        // `update_current_contract_wasm`), so a placeholder hash is
        // sufficient and no real uploaded WASM blob is required.
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GlobeWallet);
        let client = GlobeWalletClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let wasm_hash = BytesN::from_array(&env, &[7u8; 32]);
        client.propose_upgrade(&admin, &wasm_hash, &GlobeWallet::MIN_UPGRADE_DELAY_LEDGERS);

        // A non-admin cannot execute the upgrade, even once proposed —
        // rejected before the timelock or hash is even inspected.
        let non_admin = Address::generate(&env);
        assert_eq!(
            client.try_execute_upgrade(&non_admin, &wasm_hash),
            Err(Ok(WalletError::Unauthorized))
        );

        // The timelock (ready_at = ledger 0 + MIN_UPGRADE_DELAY_LEDGERS) has
        // not elapsed yet — the test env's ledger sequence defaults to 0 —
        // so even the legitimate admin must be rejected.
        assert_eq!(
            client.try_execute_upgrade(&admin, &wasm_hash),
            Err(Ok(WalletError::UpgradeNotReady))
        );
    }

    #[test]
    fn test_upgrade_rejects_hash_mismatch() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GlobeWallet);
        let client = GlobeWalletClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let wasm_hash = BytesN::from_array(&env, &[9u8; 32]);
        let other_hash = BytesN::from_array(&env, &[10u8; 32]);
        client.propose_upgrade(&admin, &wasm_hash, &GlobeWallet::MIN_UPGRADE_DELAY_LEDGERS);
        env.ledger().set_sequence_number(1);
        assert_eq!(
            client.try_execute_upgrade(&admin, &other_hash),
            Err(Ok(WalletError::UpgradeHashMismatch))
        );
    }

    #[test]
    fn test_propose_upgrade_accepts_any_hash_without_validation() {
        // Verify that propose_upgrade stores the hash as-is without checking
        // if it corresponds to a real uploaded WASM blob. This is by design:
        // validation happens at execute_upgrade time so propose_upgrade completes
        // quickly and any errors surface after the timelock (not before it).
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GlobeWallet);
        let client = GlobeWalletClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        // Use a fabricated hash that was never uploaded via upload_contract_wasm
        let never_uploaded_hash = BytesN::from_array(&env, &[42u8; 32]);

        // propose_upgrade should succeed even with an invalid hash
        assert_eq!(
            client.try_propose_upgrade(
                &admin,
                &never_uploaded_hash,
                &GlobeWallet::MIN_UPGRADE_DELAY_LEDGERS
            ),
            Ok(Ok(()))
        );

        // The proposal is stored
        let cid = id.clone();
        env.as_contract(&cid, || {
            let proposal: Option<UpgradeProposal> = env
                .storage()
                .instance()
                .get(&DataKey::PendingUpgrade);
            assert!(proposal.is_some());
            assert_eq!(proposal.unwrap().wasm_hash, never_uploaded_hash);
        });
    }

    #[test]
    #[should_panic]
    fn test_execute_upgrade_with_never_uploaded_hash_traps() {
        // This test verifies the existing behavior: execute_upgrade will trap
        // (panic) at the host level if the wasm_hash was never uploaded via
        // upload_contract_wasm. This is the primary issue being tracked in #31.
        //
        // In the future, if Soroban SDK exposes a pre-check query or this
        // contract adds a fallback mechanism, this test should be updated to
        // verify that execute_upgrade returns a typed error instead.
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GlobeWallet);
        let client = GlobeWalletClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let never_uploaded_hash = BytesN::from_array(&env, &[42u8; 32]);
        client.propose_upgrade(
            &admin,
            &never_uploaded_hash,
            &GlobeWallet::MIN_UPGRADE_DELAY_LEDGERS,
        );
        env.ledger()
            .set_sequence_number(GlobeWallet::MIN_UPGRADE_DELAY_LEDGERS);

        // This call should panic/trap at the host level because the hash
        // was never uploaded via upload_contract_wasm. The test is marked
        // #[should_panic] to capture that behavior.
        client.execute_upgrade(&admin, &never_uploaded_hash);
    }

    #[test]
    fn test_pending_upgrade_query_lifecycle() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GlobeWallet);
        let client = GlobeWalletClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        assert_eq!(client.pending_upgrade(), None);

        let hash = BytesN::from_array(&env, &[7u8; 32]);
        client.propose_upgrade(&admin, &hash, &GlobeWallet::MIN_UPGRADE_DELAY_LEDGERS);

        let pending = client.pending_upgrade();
        assert!(pending.is_some());
        let prop = pending.unwrap();
        assert_eq!(prop.wasm_hash, hash);
        assert_eq!(prop.proposed_by, admin);
    }

    // ── Issue #84: minimum timelock delays ──────────────────────────────────

    #[test]
    fn test_propose_upgrade_rejects_zero_delay() {
        // Direct port of issue #84's reproduction: delay_in_ledgers = 0 used
        // to make `execute_upgrade` immediately callable, collapsing the
        // "propose then wait" timelock into a single atomic step.
        let (env, cid, admin, client) = setup();
        let wasm_hash = BytesN::from_array(&env, &[7u8; 32]);
        assert_eq!(
            client.try_propose_upgrade(&admin, &wasm_hash, &0u32),
            Err(Ok(WalletError::UpgradeDelayTooShort))
        );
        // No proposal was stored — the rejection is not a "propose now,
        // reject on execute" style check.
        env.as_contract(&cid, || {
            assert!(!env.storage().instance().has(&DataKey::PendingUpgrade));
        });
    }

    #[test]
    fn test_propose_upgrade_rejects_delay_below_minimum() {
        let (env, _cid, admin, client) = setup();
        let wasm_hash = BytesN::from_array(&env, &[7u8; 32]);
        assert_eq!(
            client.try_propose_upgrade(
                &admin,
                &wasm_hash,
                &(GlobeWallet::MIN_UPGRADE_DELAY_LEDGERS - 1)
            ),
            Err(Ok(WalletError::UpgradeDelayTooShort))
        );
    }

    #[test]
    #[should_panic]
    fn test_propose_upgrade_accepts_delay_at_minimum() {
        // No regression to the happy path: exactly the minimum must still
        // be accepted by `propose_upgrade`, and once the timelock genuinely
        // elapses `execute_upgrade` must pass every contract-level gate
        // (admin, hash match, and — the new one — nothing left to check but
        // readiness) and reach the same host-level trap
        // `test_propose_and_execute_upgrade` and
        // `test_execute_upgrade_with_never_uploaded_hash_traps` already rely
        // on as proof there's no real WASM fixture needed to exercise this.
        let (env, _cid, admin, client) = setup();
        let wasm_hash = BytesN::from_array(&env, &[7u8; 32]);
        assert_eq!(
            client.try_propose_upgrade(&admin, &wasm_hash, &GlobeWallet::MIN_UPGRADE_DELAY_LEDGERS),
            Ok(Ok(()))
        );

        env.ledger()
            .set_sequence_number(GlobeWallet::MIN_UPGRADE_DELAY_LEDGERS);
        // Traps here (host-level): every contract-level gate, including the
        // new minimum-delay check at propose time, has already passed.
        client.execute_upgrade(&admin, &wasm_hash);
    }

    #[test]
    fn test_set_recovery_config_rejects_zero_delay() {
        // Direct port of issue #84's reproduction: delay_in_ledgers = 0 used
        // to leave the admin's post-quorum "notice and cancel" window
        // (documented on `RecoveryConfig::delay_in_ledgers`) at zero ledgers.
        let (_env, admin, _guardians, client) = setup_with_guardians(3);
        assert_eq!(
            client.try_set_recovery_config(&admin, &2u32, &0u32),
            Err(Ok(WalletError::RecoveryDelayTooShort))
        );
        assert!(client.recovery_config().is_none());
    }

    #[test]
    fn test_set_recovery_config_rejects_delay_below_minimum() {
        let (_env, admin, _guardians, client) = setup_with_guardians(3);
        assert_eq!(
            client.try_set_recovery_config(
                &admin,
                &2u32,
                &(GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS - 1)
            ),
            Err(Ok(WalletError::RecoveryDelayTooShort))
        );
    }

    #[test]
    fn test_set_recovery_config_accepts_delay_at_minimum_and_recovery_executes() {
        // No regression to the happy path: exactly the minimum must still
        // configure successfully, and a recovery that waits exactly that
        // long must still execute — full end-to-end coverage, not just the
        // setter in isolation.
        let (env, admin, guardians, client) = setup_with_guardians(3);
        assert_eq!(
            client.try_set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS),
            Ok(Ok(()))
        );

        let new_admin = Address::generate(&env);
        client.initiate_recovery(&guardians.get(0).unwrap(), &new_admin);
        client.approve_recovery(&guardians.get(1).unwrap());
        assert_eq!(
            client.try_execute_recovery(),
            Err(Ok(WalletError::RecoveryNotReady))
        );

        env.ledger()
            .with_mut(|l| l.sequence_number += GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        client.execute_recovery();
        assert_eq!(client.admin(), new_admin);
    }

    // ── Guardian Recovery ─────────────────────────────────────────────────

    fn setup_with_guardians(n: u32) -> (Env, Address, Vec<Address>, GlobeWalletClient<'static>) {
        let (env, _cid, admin, client) = setup();
        let mut guardians: Vec<Address> = Vec::new(&env);
        for _ in 0..n {
            let g = Address::generate(&env);
            client.add_guardian(&admin, &g);
            guardians.push_back(g);
        }
        (env, admin, guardians, client)
    }

    #[test]
    fn test_add_and_list_guardians() {
        let (_env, _admin, guardians, client) = setup_with_guardians(3);
        let stored = client.guardians();
        assert_eq!(stored.len(), 3);
        for i in 0..3 {
            assert_eq!(stored.get(i).unwrap(), guardians.get(i).unwrap());
        }
    }

    #[test]
    fn test_add_duplicate_guardian_fails() {
        let (_env, admin, guardians, client) = setup_with_guardians(1);
        assert_eq!(
            client.try_add_guardian(&admin, &guardians.get(0).unwrap()),
            Err(Ok(WalletError::GuardianAlreadyAdded))
        );
    }

    #[test]
    fn test_non_admin_cannot_add_guardian() {
        let (env, _admin, _guardians, client) = setup_with_guardians(1);
        let stranger = Address::generate(&env);
        let candidate = Address::generate(&env);
        assert_eq!(
            client.try_add_guardian(&stranger, &candidate),
            Err(Ok(WalletError::Unauthorized))
        );
    }

    #[test]
    fn test_max_guardians_limit() {
        // Regression test for issue #27: adding guardians up to the cap
        // succeeds; the next one is rejected with a dedicated error, mirroring
        // `test_max_assets_limit`'s coverage of `MAX_ASSETS`.
        let (env, admin, guardians, client) = setup_with_guardians(GlobeWallet::MAX_GUARDIANS);
        assert_eq!(guardians.len(), GlobeWallet::MAX_GUARDIANS);

        let extra = Address::generate(&env);
        assert_eq!(
            client.try_add_guardian(&admin, &extra),
            Err(Ok(WalletError::GuardianLimitExceeded))
        );
        assert_eq!(client.guardians().len(), GlobeWallet::MAX_GUARDIANS);
    }

    #[test]
    fn test_remove_guardian_below_threshold_fails() {
        let (_env, admin, guardians, client) = setup_with_guardians(3);
        client.set_recovery_config(&admin, &3u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        assert_eq!(
            client.try_remove_guardian(&admin, &guardians.get(0).unwrap()),
            Err(Ok(WalletError::NotEnoughGuardians))
        );
    }

    #[test]
    fn test_removed_guardian_cannot_initiate_recovery() {
        let (env, admin, guardians, client) = setup_with_guardians(4);
        client.set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        let removed = guardians.get(0).unwrap();
        client.remove_guardian(&admin, &removed);
        // Timelocked (#175): queued, not yet applied.
        assert_eq!(client.guardians().len(), 4);
        env.ledger()
            .with_mut(|l| l.sequence_number += GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        client.apply_guardian_change();
        assert_eq!(client.guardians().len(), 3);

        assert_eq!(
            client.try_initiate_recovery(&removed, &Address::generate(&env)),
            Err(Ok(WalletError::Unauthorized))
        );
    }

    #[test]
    fn test_remove_guardian_rejected_while_recovery_pending() {
        // #175: a hostile admin must not be able to strip approving
        // guardians from an in-flight recovery.
        let (env, admin, guardians, client) = setup_with_guardians(3);
        client.set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        let new_admin = Address::generate(&env);
        client.initiate_recovery(&guardians.get(0).unwrap(), &new_admin);
        client.approve_recovery(&guardians.get(1).unwrap());

        assert_eq!(
            client.try_remove_guardian(&admin, &guardians.get(1).unwrap()),
            Err(Ok(WalletError::RecoveryAlreadyPending))
        );
        assert_eq!(client.recovery_proposal().unwrap().approvals.len(), 2);

        env.ledger()
            .with_mut(|l| l.sequence_number += GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        client.execute_recovery();
        assert_eq!(client.admin(), new_admin);
    }

    #[test]
    fn test_add_guardian_rejected_while_recovery_pending() {
        // #175: no sybil dilution mid-recovery.
        let (env, admin, guardians, client) = setup_with_guardians(3);
        client.set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        client.initiate_recovery(&guardians.get(0).unwrap(), &Address::generate(&env));
        assert_eq!(
            client.try_add_guardian(&admin, &Address::generate(&env)),
            Err(Ok(WalletError::RecoveryAlreadyPending))
        );
        assert_eq!(client.guardians().len(), 3);
    }

    #[test]
    fn test_guardian_add_is_timelocked_once_recovery_configured() {
        let (env, admin, _guardians, client) = setup_with_guardians(3);
        client.set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        let newcomer = Address::generate(&env);
        client.add_guardian(&admin, &newcomer);

        let change = client.pending_guardian_change().unwrap();
        assert_eq!(change.guardian, newcomer);
        assert!(change.add);
        assert_eq!(client.guardians().len(), 3);
        assert_eq!(
            client.try_apply_guardian_change(),
            Err(Ok(WalletError::GuardianChangeNotReady))
        );
        // Only one change may be queued at a time.
        assert_eq!(
            client.try_add_guardian(&admin, &Address::generate(&env)),
            Err(Ok(WalletError::GuardianChangePending))
        );

        env.ledger()
            .with_mut(|l| l.sequence_number += GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        client.apply_guardian_change();
        assert_eq!(client.guardians().len(), 4);
        assert!(client.pending_guardian_change().is_none());
    }

    #[test]
    fn test_queued_guardian_change_frozen_by_recovery_and_discarded_on_execute() {
        let (env, admin, guardians, client) = setup_with_guardians(3);
        client.set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        // Compromised admin queues removal of an honest guardian...
        client.remove_guardian(&admin, &guardians.get(2).unwrap());
        // ...guardians react by starting a recovery inside the delay.
        let new_admin = Address::generate(&env);
        client.initiate_recovery(&guardians.get(0).unwrap(), &new_admin);
        client.approve_recovery(&guardians.get(1).unwrap());

        env.ledger()
            .with_mut(|l| l.sequence_number += GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        assert_eq!(
            client.try_apply_guardian_change(),
            Err(Ok(WalletError::RecoveryAlreadyPending))
        );
        client.execute_recovery();
        assert_eq!(client.admin(), new_admin);
        assert!(client.pending_guardian_change().is_none());
        assert_eq!(client.guardians().len(), 3);
    }

    #[test]
    fn test_cancel_guardian_change_requires_admin() {
        let (env, admin, _guardians, client) = setup_with_guardians(3);
        client.set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        client.add_guardian(&admin, &Address::generate(&env));
        assert_eq!(
            client.try_cancel_guardian_change(&Address::generate(&env)),
            Err(Ok(WalletError::Unauthorized))
        );
        client.cancel_guardian_change(&admin);
        assert!(client.pending_guardian_change().is_none());
        assert_eq!(
            client.try_apply_guardian_change(),
            Err(Ok(WalletError::NoPendingGuardianChange))
        );
    }

    #[test]
    fn test_revoke_recovery_approval_rejects_non_guardian() {
        // `revoke_recovery_approval` previously never checked guardian
        // membership at all, unlike `initiate_recovery`/`approve_recovery`.
        let (env, admin, guardians, client) = setup_with_guardians(3);
        client.set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        let new_admin = Address::generate(&env);
        client.initiate_recovery(&guardians.get(0).unwrap(), &new_admin);

        let stranger = Address::generate(&env);
        assert_eq!(
            client.try_revoke_recovery_approval(&stranger),
            Err(Ok(WalletError::Unauthorized))
        );
    }

    #[test]
    fn test_revoke_recovery_approval_rejects_removed_guardian() {
        // A guardian removed via `remove_guardian` must lose the ability to
        // call `revoke_recovery_approval` too, not just `initiate_recovery`/
        // `approve_recovery` — membership is now enforced consistently
        // across every guardian-authenticated recovery entry point.
        // Since #175 the removal must land before the recovery starts.
        let (env, admin, guardians, client) = setup_with_guardians(4);
        client.set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        let removed = guardians.get(1).unwrap();
        client.remove_guardian(&admin, &removed);
        env.ledger()
            .with_mut(|l| l.sequence_number += GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        client.apply_guardian_change();

        let new_admin = Address::generate(&env);
        client.initiate_recovery(&guardians.get(0).unwrap(), &new_admin);

        assert_eq!(
            client.try_revoke_recovery_approval(&removed),
            Err(Ok(WalletError::Unauthorized))
        );
    }

    #[test]
    fn test_upgrade_propose_double_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, GlobeWallet);
        let client = GlobeWalletClient::new(&env, &id);
        let admin = Address::generate(&env);
        client.initialize(&admin);

        let wasm_hash = BytesN::from_array(&env, &[11u8; 32]);
        client.propose_upgrade(&admin, &wasm_hash, &GlobeWallet::MIN_UPGRADE_DELAY_LEDGERS);
        // Still rejected as "already pending" even with a too-short delay —
        // the pending-proposal check takes precedence, matching the check
        // order inside `propose_upgrade`.
        assert_eq!(
            client.try_propose_upgrade(&admin, &wasm_hash, &0u32),
            Err(Ok(WalletError::UpgradeAlreadyPending))
        );
    }

    #[test]
    fn test_set_recovery_config_requires_min_guardians() {
        let (_env, admin, _guardians, client) = setup_with_guardians(2);
        assert_eq!(
            client.try_set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS),
            Err(Ok(WalletError::NotEnoughGuardians))
        );
    }

    #[test]
    fn test_set_recovery_config_rejects_single_guardian_threshold() {
        let (_env, admin, _guardians, client) = setup_with_guardians(3);
        assert_eq!(
            client.try_set_recovery_config(&admin, &1u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS),
            Err(Ok(WalletError::InvalidRecoveryThreshold))
        );
    }

    #[test]
    fn test_set_recovery_config_rejects_threshold_above_guardian_count() {
        let (_env, admin, _guardians, client) = setup_with_guardians(3);
        assert_eq!(
            client.try_set_recovery_config(&admin, &4u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS),
            Err(Ok(WalletError::NotEnoughGuardians))
        );
    }

    #[test]
    fn test_recovery_happy_path_2_of_3() {
        let (env, admin, guardians, client) = setup_with_guardians(3);
        client.set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        let new_admin = Address::generate(&env);

        client.initiate_recovery(&guardians.get(0).unwrap(), &new_admin);
        // Quorum not yet reached with 1 approval.
        assert_eq!(
            client.try_execute_recovery(),
            Err(Ok(WalletError::RecoveryNotQuorate))
        );

        client.approve_recovery(&guardians.get(1).unwrap());
        // Quorum reached, but timelock not yet elapsed.
        assert_eq!(
            client.try_execute_recovery(),
            Err(Ok(WalletError::RecoveryNotReady))
        );

        env.ledger()
            .with_mut(|l| l.sequence_number += GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        client.execute_recovery();
        assert_eq!(client.admin(), new_admin);
        assert!(client.recovery_proposal().is_none());
    }

    #[test]
    fn test_recovery_rejects_non_guardian() {
        let (env, admin, _guardians, client) = setup_with_guardians(3);
        client.set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        let stranger = Address::generate(&env);
        let new_admin = Address::generate(&env);
        assert_eq!(
            client.try_initiate_recovery(&stranger, &new_admin),
            Err(Ok(WalletError::Unauthorized))
        );
    }

    #[test]
    fn test_admin_can_cancel_recovery_before_quorum() {
        let (env, admin, guardians, client) = setup_with_guardians(5);
        client.set_recovery_config(&admin, &3u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        client.initiate_recovery(&guardians.get(0).unwrap(), &Address::generate(&env));
        client.cancel_recovery(&admin);
        assert!(client.recovery_proposal().is_none());
    }

    #[test]
    fn test_admin_cancel_after_quorum_limited_to_first_half_of_timelock() {
        // #175: 3-of-5, quorum at 3 approvals (below the 2/3 supermajority
        // of 4), so only the window rule applies.
        let (env, admin, guardians, client) = setup_with_guardians(5);
        client.set_recovery_config(&admin, &3u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        let new_admin = Address::generate(&env);
        client.initiate_recovery(&guardians.get(0).unwrap(), &new_admin);
        client.approve_recovery(&guardians.get(1).unwrap());
        client.approve_recovery(&guardians.get(2).unwrap());
        assert!(client.recovery_proposal().unwrap().ready_at.is_some());

        // Past the first half of the delay: a (possibly compromised) admin
        // can no longer cancel.
        env.ledger().with_mut(|l| {
            l.sequence_number += GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS / 2 + 1
        });
        assert_eq!(
            client.try_cancel_recovery(&admin),
            Err(Ok(WalletError::RecoveryCancelNotAllowed))
        );
        env.ledger()
            .with_mut(|l| l.sequence_number += GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        client.execute_recovery();
        assert_eq!(client.admin(), new_admin);
    }

    #[test]
    fn test_admin_cancel_inside_window_still_works_below_supermajority() {
        let (env, admin, guardians, client) = setup_with_guardians(5);
        client.set_recovery_config(&admin, &3u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        client.initiate_recovery(&guardians.get(0).unwrap(), &Address::generate(&env));
        client.approve_recovery(&guardians.get(1).unwrap());
        client.approve_recovery(&guardians.get(2).unwrap());
        env.ledger().with_mut(|l| l.sequence_number += 10);
        client.cancel_recovery(&admin);
        assert!(client.recovery_proposal().is_none());
        assert_eq!(client.admin(), admin);
    }

    #[test]
    fn test_guardian_supermajority_overrides_admin_cancel() {
        // 2-of-3: two approvals is already >= 2/3 of the set, so the admin
        // cannot cancel even immediately after quorum.
        let (env, admin, guardians, client) = setup_with_guardians(3);
        client.set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        let new_admin = Address::generate(&env);
        client.initiate_recovery(&guardians.get(0).unwrap(), &new_admin);
        client.approve_recovery(&guardians.get(1).unwrap());
        assert_eq!(
            client.try_cancel_recovery(&admin),
            Err(Ok(WalletError::RecoveryCancelNotAllowed))
        );
        env.ledger()
            .with_mut(|l| l.sequence_number += GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        client.execute_recovery();
        assert_eq!(client.admin(), new_admin);
    }

    #[test]
    fn test_revoking_approval_below_threshold_resets_timelock() {
        let (env, admin, guardians, client) = setup_with_guardians(3);
        client.set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        let new_admin = Address::generate(&env);

        client.initiate_recovery(&guardians.get(0).unwrap(), &new_admin);
        client.approve_recovery(&guardians.get(1).unwrap());
        env.ledger()
            .with_mut(|l| l.sequence_number += GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);

        // A guardian has second thoughts and revokes right as the timelock
        // would otherwise have expired.
        client.revoke_recovery_approval(&guardians.get(1).unwrap());
        assert_eq!(
            client.try_execute_recovery(),
            Err(Ok(WalletError::RecoveryNotQuorate))
        );

        // Re-approving requires a fresh timelock window.
        client.approve_recovery(&guardians.get(1).unwrap());
        assert_eq!(
            client.try_execute_recovery(),
            Err(Ok(WalletError::RecoveryNotReady))
        );
        env.ledger()
            .with_mut(|l| l.sequence_number += GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        client.execute_recovery();
        assert_eq!(client.admin(), new_admin);
    }

    #[test]
    fn test_double_approval_rejected() {
        let (env, admin, guardians, client) = setup_with_guardians(3);
        client.set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        let new_admin = Address::generate(&env);
        client.initiate_recovery(&guardians.get(0).unwrap(), &new_admin);
        assert_eq!(
            client.try_approve_recovery(&guardians.get(0).unwrap()),
            Err(Ok(WalletError::AlreadyApproved))
        );
    }

    #[test]
    fn test_cannot_initiate_second_recovery_while_one_pending() {
        let (env, admin, guardians, client) = setup_with_guardians(3);
        client.set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        let new_admin_a = Address::generate(&env);
        let new_admin_b = Address::generate(&env);
        client.initiate_recovery(&guardians.get(0).unwrap(), &new_admin_a);
        assert_eq!(
            client.try_initiate_recovery(&guardians.get(1).unwrap(), &new_admin_b),
            Err(Ok(WalletError::RecoveryAlreadyPending))
        );
    }

    #[test]
    fn test_recovery_clears_any_in_flight_normal_admin_transfer() {
        let (env, admin, guardians, client) = setup_with_guardians(3);
        client.set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        let normal_candidate = Address::generate(&env);
        let recovery_admin = Address::generate(&env);

        // Admin starts a normal (non-recovery) transfer...
        client.propose_admin(&admin, &normal_candidate);

        // ...but the device is lost before it's accepted, so guardians recover instead.
        client.initiate_recovery(&guardians.get(0).unwrap(), &recovery_admin);
        client.approve_recovery(&guardians.get(1).unwrap());
        env.ledger()
            .with_mut(|l| l.sequence_number += GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        client.execute_recovery();

        assert_eq!(client.admin(), recovery_admin);
        // The stale normal-transfer proposal must not let the old candidate
        // still claim admin after recovery has already happened.
        assert_eq!(
            client.try_accept_admin(&normal_candidate),
            Err(Ok(WalletError::NoPendingAdmin))
        );
    }

    #[test]
    fn test_execute_recovery_rejects_new_admin_same_as_current_admin() {
        // Regression test for issue #42: a recovery proposal that targets the
        // already-current admin must be rejected at execute_recovery time
        // rather than silently succeeding as a no-op transfer.
        let (env, admin, guardians, client) = setup_with_guardians(3);
        client.set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);

        client.initiate_recovery(&guardians.get(0).unwrap(), &admin);
        client.approve_recovery(&guardians.get(1).unwrap());
        env.ledger()
            .with_mut(|l| l.sequence_number += GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);

        assert_eq!(
            client.try_execute_recovery(),
            Err(Ok(WalletError::RecoveryNewAdminUnchanged))
        );
        assert_eq!(client.admin(), admin);
        // The rejected proposal is left in place (execute_recovery is
        // side-effect-free on this rejection path) so guardians/admin can
        // still cancel it explicitly rather than it being silently consumed.
        assert!(client.recovery_proposal().is_some());
    }

    /// Decode the topics/data of the most-recently-published event whose
    /// first topic is the given symbol name. Returns `None` if no such
    /// event was published. This is the first place in this test module
    /// events are decoded rather than just trusted to have fired — see
    /// issue #91's Definition of done, which specifically requires proving
    /// *which* events fired and *what* they carried, not just that
    /// `execute_recovery`/`accept_admin` returned `Ok(())`.
    fn find_event(env: &Env, topic_name: &str) -> Option<(soroban_sdk::Vec<Val>, Val)> {
        let target = Symbol::new(env, topic_name);
        for (_contract_id, topics, data) in all_events(env) {
            if let Some(first) = topics.first() {
                if let Ok(sym) = Symbol::try_from_val(env, &first) {
                    if sym == target {
                        return Some((topics, data));
                    }
                }
            }
        }
        None
    }

    #[test]
    fn test_execute_recovery_emits_both_admin_transferred_and_recovery_completed() {
        // issue #91: execute_recovery must publish BOTH the pre-existing
        // admin_transferred event (unchanged, for backward compatibility)
        // AND a new, distinctly-named recovery_completed event carrying
        // enough context for a monitoring integration to act on it.
        let (env, admin, guardians, client) = setup_with_guardians(3);
        client.set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);

        let new_admin = Address::generate(&env);
        client.initiate_recovery(&guardians.get(0).unwrap(), &new_admin);
        client.approve_recovery(&guardians.get(1).unwrap());
        // Quorum (2) reached on this second approval; ready_at was armed as
        // current_sequence + MIN_RECOVERY_DELAY_LEDGERS inside approve_recovery.
        // Advance exactly to that boundary so this test also pins the
        // inclusive `>=` semantics execute_recovery's
        // `env.ledger().sequence() < ready_at` check implies, rather than
        // overshooting and leaving that untested.
        let ready_at = client.recovery_proposal().unwrap().ready_at.unwrap();
        env.ledger().with_mut(|l| l.sequence_number = ready_at);

        client.execute_recovery();

        // ── admin_transferred: unchanged shape, so existing consumers are
        // never asked to understand a new event just to keep working. ──
        let (transferred_topics, transferred_data) =
            find_event(&env, "admin_transferred").expect("admin_transferred must still be published");
        assert_eq!(transferred_topics.len(), 2); // (name, EVENT_VERSION)
        let decoded_transfer: (Address, Address) =
            <(Address, Address)>::try_from_val(&env, &transferred_data).unwrap();
        assert_eq!(decoded_transfer, (admin.clone(), new_admin.clone()));

        // ── recovery_completed: the new, distinguishing event. ──
        let (completed_topics, completed_data) =
            find_event(&env, "recovery_completed").expect("recovery_completed must be published");
        assert_eq!(completed_topics.len(), 2); // (name, EVENT_VERSION)
        let decoded: RecoveryCompletedEvent =
            RecoveryCompletedEvent::try_from_val(&env, &completed_data).unwrap();
        assert_eq!(decoded.old_admin, admin);
        assert_eq!(decoded.new_admin, new_admin);
        // Exactly the two guardians who approved -- not the third, silent one.
        assert_eq!(decoded.approving_guardians.len(), 2);
        assert!(decoded.approving_guardians.contains(&guardians.get(0).unwrap()));
        assert!(decoded.approving_guardians.contains(&guardians.get(1).unwrap()));
        assert!(!decoded.approving_guardians.contains(&guardians.get(2).unwrap()));
        assert_eq!(decoded.threshold, 2);
        assert_eq!(decoded.ready_at, ready_at);
        assert_eq!(decoded.executed_at, ready_at); // executed at the earliest possible ledger
        // Getter last: soroban-sdk 22+ events().all() only covers the latest
        // invocation, so any call before find_event would hide these events.
        assert_eq!(client.admin(), new_admin);
    }

    #[test]
    fn test_execute_recovery_emits_recovery_completed_with_full_over_quorum_guardian_set() {
        // Companion to the test above: proves approving_guardians reflects
        // every approval actually on the proposal, not just `threshold` of
        // them -- a 5-guardian wallet recovered 5-of-5 is a materially
        // different signal (overwhelming, unanimous consent) than the same
        // wallet recovered at its bare 3-guardian threshold, and this field
        // is what lets a monitoring integration tell the two apart.
        let (env, admin, guardians, client) = setup_with_guardians(5);
        client.set_recovery_config(&admin, &3u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);

        let new_admin = Address::generate(&env);
        client.initiate_recovery(&guardians.get(0).unwrap(), &new_admin);
        client.approve_recovery(&guardians.get(1).unwrap());
        client.approve_recovery(&guardians.get(2).unwrap()); // quorum(3) reached here
        client.approve_recovery(&guardians.get(3).unwrap()); // extra approval, above threshold
        client.approve_recovery(&guardians.get(4).unwrap()); // unanimous

        let ready_at = client.recovery_proposal().unwrap().ready_at.unwrap();
        env.ledger().with_mut(|l| l.sequence_number = ready_at + 3); // executed a few ledgers late, on purpose

        client.execute_recovery();

        let (_, completed_data) =
            find_event(&env, "recovery_completed").expect("recovery_completed must be published");
        let decoded: RecoveryCompletedEvent =
            RecoveryCompletedEvent::try_from_val(&env, &completed_data).unwrap();
        assert_eq!(decoded.approving_guardians.len(), 5); // all five, not just the threshold(3)
        assert_eq!(decoded.threshold, 3);
        assert_eq!(decoded.ready_at, ready_at);
        assert_eq!(decoded.executed_at, ready_at + 3); // the promptness gap is observable
    }

    #[test]
    fn test_accept_admin_emits_only_admin_transferred_not_recovery_completed() {
        // issue #91: a routine, self-initiated admin transfer must NOT
        // publish recovery_completed -- that event's entire value is that
        // its presence unambiguously means guardian recovery happened.
        // If a normal accept_admin ever emitted it too, that guarantee
        // (and every alerting integration built on it) would be worthless.
        let (env, _cid, admin, client) = setup();
        let candidate = Address::generate(&env);
        client.propose_admin(&admin, &candidate);
        client.accept_admin(&candidate);

        // soroban-sdk 22+: events().all() only covers the latest invocation,
        // so check the events before any further (getter) call.
        assert!(
            find_event(&env, "admin_transferred").is_some(),
            "routine transfer must still emit admin_transferred"
        );
        assert!(
            find_event(&env, "recovery_completed").is_none(),
            "routine transfer must never emit recovery_completed"
        );
        assert_eq!(client.admin(), candidate);
    }

    #[test]
    fn test_set_recovery_config_rejected_while_recovery_pending() {
        // Regression test for issue #28: config changes mid-recovery are
        // rejected outright rather than silently interacting with an
        // in-flight proposal's frozen `ready_at` / live `threshold` check.
        let (env, admin, guardians, client) = setup_with_guardians(3);
        client.set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        let new_admin = Address::generate(&env);
        client.initiate_recovery(&guardians.get(0).unwrap(), &new_admin);

        assert_eq!(
            client.try_set_recovery_config(&admin, &3u32, &5u32),
            Err(Ok(WalletError::RecoveryAlreadyPending))
        );

        // Config is unchanged.
        let config = client.recovery_config().unwrap();
        assert_eq!(config.threshold, 2);
        assert_eq!(config.delay_in_ledgers, GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);

        // Cancelling the pending recovery unblocks reconfiguration again.
        client.cancel_recovery(&admin);
        client.set_recovery_config(&admin, &3u32, &(GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS + 1));
        let config = client.recovery_config().unwrap();
        assert_eq!(config.threshold, 3);
        assert_eq!(
            config.delay_in_ledgers,
            GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS + 1
        );
    }

    #[test]
    fn test_pending_admin_cleared_after_accept_admin() {
        // Regression test for issue #44: after a normal admin transfer
        // completes, `PendingAdmin(old_admin)` must not become orphaned
        // garbage in instance storage — it must actually be removed, not
        // merely superseded. `execute_recovery` already has an equivalent
        // regression test (`test_recovery_clears_any_in_flight_normal_admin_transfer`);
        // this covers the other (and more common) admin-rotation path.
        let (env, cid, admin, client) = setup();
        let candidate = Address::generate(&env);
        client.propose_admin(&admin, &candidate);
        env.as_contract(&cid, || {
            assert!(env
                .storage()
                .instance()
                .has(&DataKey::PendingAdmin(admin.clone())));
        });

        client.accept_admin(&candidate);
        assert_eq!(client.admin(), candidate);
        env.as_contract(&cid, || {
            assert!(!env
                .storage()
                .instance()
                .has(&DataKey::PendingAdmin(admin.clone())));
        });

        // Confirm it's genuinely gone, not just superseded: a fresh
        // propose/accept cycle back to the old admin address must require
        // its own fresh acceptance rather than resolving against any stale
        // leftover entry keyed under that address.
        client.propose_admin(&candidate, &admin);
        client.accept_admin(&admin);
        assert_eq!(client.admin(), admin);
    }

    #[test]
    fn test_pending_admin_query_lifecycle() {
        let (env, _cid, admin, client) = setup();
        assert_eq!(client.pending_admin(), None);

        let candidate = Address::generate(&env);
        client.propose_admin(&admin, &candidate);
        assert_eq!(client.pending_admin(), Some(candidate.clone()));

        client.cancel_admin_transfer(&admin);
        assert_eq!(client.pending_admin(), None);

        client.propose_admin(&admin, &candidate);
        assert_eq!(client.pending_admin(), Some(candidate.clone()));

        client.accept_admin(&candidate);
        assert_eq!(client.pending_admin(), None);
        assert_eq!(client.admin(), candidate);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Rolling 24 h spend window (issue #177)
    //
    // Spends are counted in hourly buckets; 25 buckets (24 + 1 guard) are
    // kept, so a spend stays counted for at least 24 h and at most 25 h.
    // There is no midnight reset.
    // ═══════════════════════════════════════════════════════════════════════════

    const H: u64 = 3_600;
    const DAY: u64 = 86_400;

    fn set_time(env: &Env, ts: u64) {
        env.ledger().with_mut(|l| l.timestamp = ts);
    }

    /// The exact attack from #177: full limit at 23:59 UTC, then again at
    /// 00:00 UTC. The second spend must be rejected.
    #[test]
    fn test_rolling_window_blocks_midnight_double_spend() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let _code = Address::generate(&env);
        let code_token = Address::generate(&env);
        client.set_spend_limit(&user, &code_token, &1_000_i128);

        set_time(&env, 2 * DAY - 60);
        client.record_spend(&user, &code_token, &1_000_i128);

        set_time(&env, 2 * DAY);
        assert_eq!(
            client.try_record_spend(&user, &code_token, &1_i128),
            Err(Ok(WalletError::SpendLimitExceeded))
        );

        // Still blocked 23 h 59 m after the spend.
        set_time(&env, 3 * DAY - 61);
        assert_eq!(
            client.try_record_spend(&user, &code_token, &1_i128),
            Err(Ok(WalletError::SpendLimitExceeded))
        );

        // Fully available again once the spend's bucket has rolled off.
        set_time(&env, 2 * DAY - 60 + DAY + H);
        client.record_spend(&user, &code_token, &1_000_i128);
    }

    /// Spends roll off one bucket at a time, not all at once.
    #[test]
    fn test_rolling_window_refills_partially() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let _code = Address::generate(&env);
        let code_token = Address::generate(&env);
        client.set_spend_limit(&user, &code_token, &1_000_i128);

        let t0 = 10 * DAY;
        set_time(&env, t0);
        client.record_spend(&user, &code_token, &600_i128);
        set_time(&env, t0 + 10 * H);
        client.record_spend(&user, &code_token, &400_i128);

        // 25 h after the first spend only its 600 is back.
        set_time(&env, t0 + 25 * H);
        assert_eq!(client.get_spent_today(&user, &code_token), 400);
        assert_eq!(
            client.try_record_spend(&user, &code_token, &601_i128),
            Err(Ok(WalletError::SpendLimitExceeded))
        );
        client.record_spend(&user, &code_token, &600_i128);
    }

    #[test]
    fn test_spend_allowance_reports_rolling_window_and_next_refill() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let _code = String::from_str(&env, "XLM");
        let code_token = Address::generate(&env);
        client.set_spend_limit(&user, &code_token, &1_000_i128);

        let t0 = 5 * DAY + 30 * 60; // 00:30 UTC
        set_time(&env, t0);
        let empty = client.get_spend_allowance(&user, &code_token);
        assert_eq!(empty.spent, 0);
        assert_eq!(empty.remaining, 1_000);
        assert_eq!(empty.next_refill_at, 0);
        assert_eq!(empty.window_resets_at, t0);

        client.record_spend(&user, &code_token, &300_i128);
        set_time(&env, t0 + 2 * H);
        client.record_spend(&user, &code_token, &200_i128);

        let a = client.get_spend_allowance(&user, &code_token);
        assert_eq!(a.limit, 1_000);
        assert_eq!(a.spent, 500);
        assert_eq!(a.remaining, 500);
        let first_hour = t0 / H;
        assert_eq!(a.next_refill_at, (first_hour + 25) * H);
        assert_eq!(a.window_resets_at, (first_hour + 2 + 25) * H);
        assert_eq!(a.window_start, (first_hour + 2 - 24) * H);

        // At next_refill_at the first spend is gone.
        set_time(&env, a.next_refill_at);
        let b = client.get_spend_allowance(&user, &code_token);
        assert_eq!(b.spent, 200);
        assert_eq!(b.remaining, 800);
    }

    /// Small deterministic PRNG so the property test needs no extra crate.
    struct XorShift(u64);
    impl XorShift {
        fn next(&mut self) -> u64 {
            let mut x = self.0;
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            self.0 = x;
            x
        }
    }

    /// Property (issue #177): over arbitrary spend sequences, the accepted
    /// spends inside any 24 h interval never sum to more than the limit,
    /// and the contract never under-counts the trailing 24 h.
    #[test]
    fn test_property_rolling_window_never_exceeds_limit_in_any_24h() {
        for seed in 1..=12u64 {
            let (env, _cid, _admin, client) = setup();
            let user = Address::generate(&env);
            let _code = String::from_str(&env, "XLM");
            let code_token = Address::generate(&env);
            let mut rng = XorShift(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15));
            let limit: i128 = 1_000 + (rng.next() % 9_000) as i128;
            client.set_spend_limit(&user, &code_token, &limit);

            let mut now: u64 = DAY * (1 + rng.next() % 30) + rng.next() % DAY;
            let mut accepted: std::vec::Vec<(u64, i128)> = std::vec::Vec::new();
            for _ in 0..60 {
                // Mix tiny steps, ~hour steps and multi-hour jumps, plus
                // steps that land right on bucket and day boundaries.
                now += match rng.next() % 5 {
                    0 => rng.next() % 60,
                    1 => rng.next() % (2 * H),
                    2 => rng.next() % (8 * H),
                    3 => H - (now % H),
                    _ => DAY - (now % DAY),
                };
                set_time(&env, now);
                let amount: i128 = 1 + (rng.next() % (limit as u64)) as i128;
                if client.try_record_spend(&user, &code_token, &amount).is_ok() {
                    accepted.push((now, amount));
                }

                let exact: i128 = accepted
                    .iter()
                    .filter(|(t, _)| *t + DAY > now)
                    .map(|(_, a)| *a)
                    .sum();
                assert!(exact <= limit, "seed {seed}: {exact} spent in 24 h > limit {limit}");
                assert!(
                    client.get_spent_today(&user, &code_token) >= exact,
                    "seed {seed}: window under-counts the trailing 24 h"
                );
            }
            // Every 24 h interval, not just those ending "now".
            for (i, (ti, _)) in accepted.iter().enumerate() {
                let sum: i128 = accepted[i..]
                    .iter()
                    .filter(|(t, _)| *t < *ti + DAY)
                    .map(|(_, a)| *a)
                    .sum();
                assert!(sum <= limit, "seed {seed}: interval from {ti} sums to {sum} > {limit}");
            }
        }
    }

    /// Pre-#177 `DailySpent` data is carried into the new window instead of
    /// being forgotten on upgrade.
    #[test]
    fn test_legacy_daily_spent_is_carried_into_rolling_window() {
        // Full upgrade path: pre-#173 (user, asset_code) limit + fixed-day
        // record → migrate_spend_limit → token-keyed legacy record → folded
        // into the rolling window by the next spend.
        let (env, cid, admin, client) = setup();
        let user = Address::generate(&env);
        let code = String::from_str(&env, "XLM");
        let code_token = Address::generate(&env);
        let now = 7 * DAY + 5 * H;
        set_time(&env, now);
        env.as_contract(&cid, || {
            env.storage()
                .persistent()
                .set(&DataKey::SpendLimit(user.clone(), code.clone()), &1_000_i128);
            env.storage().persistent().set(
                &DataKey::DailySpent(user.clone(), code.clone()),
                &SpendRecord { amount: 900, day: now / DAY },
            );
        });
        assert!(client.migrate_spend_limit(&admin, &user, &code, &code_token));
        assert_eq!(client.get_spend_limit(&user, &code_token), 1_000);
        assert_eq!(client.get_spent_today(&user, &code_token), 900);
        assert_eq!(
            client.try_record_spend(&user, &code_token, &101_i128),
            Err(Ok(WalletError::SpendLimitExceeded))
        );
        client.record_spend(&user, &code_token, &100_i128);
        env.as_contract(&cid, || {
            assert!(!env.storage().persistent().has(&DataKey::DailySpent(user.clone(), code.clone())));
            assert!(!env
                .storage()
                .persistent()
                .has(&DataKey::TokenDailySpent(user.clone(), code_token.clone())));
            assert!(env.storage().persistent().has(&DataKey::SpendWindow(user.clone(), code_token.clone())));
        });
        assert_eq!(client.get_spent_today(&user, &code_token), 1_000);
    }

    #[test]
    fn test_legacy_daily_spent_from_long_ago_is_ignored() {
        let (env, cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let code_token = Address::generate(&env);
        client.set_spend_limit(&user, &code_token, &1_000_i128);
        let now = 7 * DAY + 5 * H;
        set_time(&env, now);
        env.as_contract(&cid, || {
            // The token-keyed legacy record is what the window loader reads
            // (migrate_spend_limit moves pre-#173 DailySpent there).
            env.storage().persistent().set(
                &DataKey::TokenDailySpent(user.clone(), code_token.clone()),
                &SpendRecord { amount: 900, day: now / DAY - 3 },
            );
        });
        assert_eq!(client.get_spent_today(&user, &code_token), 0);
        client.record_spend(&user, &code_token, &1_000_i128);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Spend recorded regardless of limit (issue #179)
    // ═══════════════════════════════════════════════════════════════════════════

    #[test]
    fn test_spend_without_limit_is_still_recorded() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let _code = String::from_str(&env, "XLM");
        let code_token = Address::generate(&env);
        client.record_spend(&user, &code_token, &10_000_i128);
        assert!(find_event(&env, "spend_recorded").is_some());
        assert_eq!(client.get_spent_today(&user, &code_token), 10_000);
        let a = client.get_spend_allowance(&user, &code_token);
        assert_eq!(a.limit, 0);
        assert_eq!(a.spent, 10_000);
    }

    /// Send then set limit ⇒ remaining allowance reflects the earlier spend.
    #[test]
    fn test_send_then_set_limit_reflects_earlier_spend() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let _code = String::from_str(&env, "XLM");
        let code_token = Address::generate(&env);
        client.record_spend(&user, &code_token, &400_i128);
        client.set_spend_limit(&user, &code_token, &1_000_i128);
        let a = client.get_spend_allowance(&user, &code_token);
        assert_eq!(a.spent, 400);
        assert_eq!(a.remaining, 600);
        assert_eq!(
            client.try_record_spend(&user, &code_token, &601_i128),
            Err(Ok(WalletError::SpendLimitExceeded))
        );
        client.record_spend(&user, &code_token, &600_i128);
    }

    /// The #179 scenario: 10 000 sent unlimited, then a 1 000 limit. The
    /// retroactive check now sees the 10 000, so the user cannot get a
    /// fresh 1 000 on top of it.
    #[test]
    fn test_large_unlimited_spend_then_lower_limit_is_retroactive() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let _code = String::from_str(&env, "XLM");
        let code_token = Address::generate(&env);
        set_time(&env, 3 * DAY);
        client.record_spend(&user, &code_token, &10_000_i128);
        assert_eq!(
            client.try_set_spend_limit(&user, &code_token, &1_000_i128),
            Err(Ok(WalletError::SpendLimitExceeded))
        );
        assert_eq!(client.get_spend_limit(&user, &code_token), 0);

        // Once the spend rolls off, the limit can be set and is fully available.
        set_time(&env, 3 * DAY + 25 * H);
        client.set_spend_limit(&user, &code_token, &1_000_i128);
        client.record_spend(&user, &code_token, &1_000_i128);
        assert_eq!(
            client.try_record_spend(&user, &code_token, &1_i128),
            Err(Ok(WalletError::SpendLimitExceeded))
        );
    }

    /// Order of operations no longer matters: set-then-spend and
    /// spend-then-set leave the same remaining allowance.
    #[test]
    fn test_spend_limit_order_of_operations_is_consistent() {
        let (env, _cid, _admin, client) = setup();
        let _code = String::from_str(&env, "XLM");
        let code_token = Address::generate(&env);
        let a = Address::generate(&env);
        let b = Address::generate(&env);

        client.set_spend_limit(&a, &code_token, &1_000_i128);
        client.record_spend(&a, &code_token, &250_i128);

        client.record_spend(&b, &code_token, &250_i128);
        client.set_spend_limit(&b, &code_token, &1_000_i128);

        assert_eq!(
            client.get_spend_allowance(&a, &code_token).remaining,
            client.get_spend_allowance(&b, &code_token).remaining
        );
    }

    #[test]
    fn test_unlimited_spend_bookkeeping_never_overflows_into_an_error() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let _code = String::from_str(&env, "XLM");
        let code_token = Address::generate(&env);
        client.record_spend(&user, &code_token, &i128::MAX);
        client.record_spend(&user, &code_token, &i128::MAX);
        assert_eq!(client.get_spent_today(&user, &code_token), i128::MAX);
    }

    #[test]
    fn test_native_code_with_issuer_is_contradictory_and_rejected() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let bogus = AssetInfo {
            code: String::from_str(&env, "XLM"),
            issuer: Some(Address::generate(&env)),
        };
        assert_eq!(
            client.try_add_asset(&user, &bogus),
            Err(Ok(WalletError::InvalidAssetInfo))
        );
    }

    #[test]
    fn test_non_native_code_without_issuer_is_underspecified_and_rejected() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let ambiguous = AssetInfo {
            code: String::from_str(&env, "USDC"),
            issuer: None,
        };
        assert_eq!(
            client.try_add_asset(&user, &ambiguous),
            Err(Ok(WalletError::InvalidAssetInfo))
        );
    }

    // ── TTL Extension ───────────────────────────────────────────────────
    //
    // Proactive extend_ttl on every write keeps UserAssets and SpendLimit
    // entries alive past the default persistent-entry TTL (4096 ledgers
    // in test env). Without it, a wallet that goes quiet while the
    // contract stays active could have its entries archived.

    #[test]
    fn test_user_assets_ttl_extension_after_long_idle_period() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        client.add_asset(&user, &xlm(&env));
        client.add_asset(&user, &usdc(&env));

        // Jump well past the default persistent-entry TTL (4096 ledgers).
        // Without extend_ttl, the entry's default TTL would have expired
        // and the archived entry would not be readable without a restore.
        env.ledger().with_mut(|l| l.sequence_number += 50_000);

        let assets = client.get_assets(&user);
        assert_eq!(assets.len(), 2);
        assert_eq!(assets.get(0).unwrap().code, String::from_str(&env, "XLM"));
    }

    #[test]
    fn test_spend_limit_ttl_extension_after_long_idle_period() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let _code = Address::generate(&env);
        let code_token = Address::generate(&env);
        client.set_spend_limit(&user, &code_token, &1_000_000_i128);

        // Jump well past default persistent-entry TTL.
        env.ledger().with_mut(|l| l.sequence_number += 50_000);

        assert_eq!(client.get_spend_limit(&user, &code_token), 1_000_000);
    }

    // ── Wiring: globe-wallet <-> token-wrapper ───────────────────────────────
    //
    // See docs/design/wiring-reentrancy-threat-model.md for the full design
    // rationale these tests exercise.

    /// Allowlisting is timelocked (issue #189), so wiring tests jump the
    /// ledger by `ALLOWLIST_DELAY_LEDGERS`. Give every entry created after
    /// this call (wrapper/SAC instances, balances) a TTL that outlives the
    /// jump, so the test exercises the timelock rather than archival.
    fn long_ttls(env: &Env) {
        env.ledger().with_mut(|l| {
            l.min_persistent_entry_ttl = 1_000_000;
            l.min_temp_entry_ttl = 1_000_000;
            l.max_entry_ttl = 2_000_000;
        });
    }

    fn setup_wiring() -> (Env, Address, Address, GlobeWalletClient<'static>, token_wrapper::TokenWrapperClient<'static>) {
        let (env, wallet_id, admin, client) = setup();
        long_ttls(&env);
        let wrapper_id = env.register_contract(None, token_wrapper::TokenWrapper);
        let wrapper_client = token_wrapper::TokenWrapperClient::new(&env, &wrapper_id);
        client.set_token_wrapper(&admin, &wrapper_id);
        (env, wallet_id, admin, client, wrapper_client)
    }

    fn create_real_token<'a>(env: &Env, admin: &Address) -> (Address, soroban_sdk::token::StellarAssetClient<'a>, soroban_sdk::token::Client<'a>) {
        let (address, _key) = create_sac(env, admin);
        (
            address.clone(),
            soroban_sdk::token::StellarAssetClient::new(env, &address),
            soroban_sdk::token::Client::new(env, &address),
        )
    }

    /// `register_stellar_asset_contract_v2` always wraps the classic asset
    /// `aaa:<random issuer>`; returns the SAC address and the issuer's raw
    /// ed25519 key so tests can drive `propose_allowed_token` with the real
    /// asset identity.
    const TEST_SAC_CODE: &str = "aaa";

    fn create_sac(env: &Env, admin: &Address) -> (Address, BytesN<32>) {
        long_ttls(env);
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let issuer = sac.issuer().address();
        let key = match soroban_sdk::xdr::ScAddress::from(&issuer) {
            soroban_sdk::xdr::ScAddress::Account(soroban_sdk::xdr::AccountId(
                soroban_sdk::xdr::PublicKey::PublicKeyTypeEd25519(soroban_sdk::xdr::Uint256(k)),
            )) => BytesN::from_array(env, &k),
            _ => panic!("SAC issuer must be an account"),
        };
        (sac.address(), key)
    }

    /// Propose + wait out the timelock + execute, as an allowlist manager would.
    fn allow_sac(env: &Env, client: &GlobeWalletClient, caller: &Address, token_id: &Address, key: &BytesN<32>) {
        client.propose_allowed_token(
            caller,
            token_id,
            &String::from_str(env, TEST_SAC_CODE),
            &Some(key.clone()),
        );
        let ready_at = client.pending_allowed_token(token_id).unwrap().ready_at;
        env.ledger().with_mut(|l| l.sequence_number = ready_at);
        client.execute_allowed_token(caller, token_id);
    }

    /// Allowlisted real SAC + its admin/token clients.
    fn create_allowed_token<'a>(
        env: &Env,
        client: &GlobeWalletClient,
        admin: &Address,
        token_admin: &Address,
    ) -> (Address, soroban_sdk::token::StellarAssetClient<'a>, soroban_sdk::token::Client<'a>) {
        let (address, key) = create_sac(env, token_admin);
        allow_sac(env, client, admin, &address, &key);
        (
            address.clone(),
            soroban_sdk::token::StellarAssetClient::new(env, &address),
            soroban_sdk::token::Client::new(env, &address),
        )
    }

    #[test]
    fn test_send_happy_path_moves_tokens_and_records_spend() {
        let (env, wallet_id, admin, client, wrapper_client) = setup_wiring();
        let token_admin = Address::generate(&env);
        let user = Address::generate(&env);
        let to = Address::generate(&env);
        let (token_id, token_admin_client, token) = create_allowed_token(&env, &client, &admin, &token_admin);
        token_admin_client.mint(&user, &1_000);

        client.set_spend_limit(&user, &token_id, &500_i128);

        env.ledger().with_mut(|l| l.sequence_number = 100);
        wrapper_client.approve(&user, &wallet_id, &token_id, &500, &10_000, &None);

        client.send(&user, &token_id, &to, &200);

        // Events first: soroban-sdk 22+ only keeps the latest invocation's.
        let (topics, data) = find_event(&env, "send_executed").expect("send_executed");
        assert_eq!(u32::try_from_val(&env, &topics.get(1).unwrap()).unwrap(), EVENT_VERSION);
        let ev = SendExecutedEvent::try_from_val(&env, &data).unwrap();
        assert_eq!(ev.user, user);
        assert_eq!(ev.token_id, token_id);
        assert_eq!(ev.amount, 200);
        assert_eq!(token.balance(&user), 800);
        assert_eq!(token.balance(&to), 200);
        assert_eq!(wrapper_client.allowance(&user, &wallet_id, &token_id).amount, 300);
    }

    #[test]
    fn test_send_rejects_disallowed_token() {
        let (env, _wallet_id, _admin, client, _wrapper_client) = setup_wiring();
        let user = Address::generate(&env);
        let to = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let (token_id, _token_admin_client, _token) = create_real_token(&env, &token_admin);
        // Deliberately NOT allowlisted.

        assert_eq!(
            client.try_send(&user, &token_id, &to, &100),
            Err(Ok(WalletError::TokenNotAllowed))
        );
    }

    // ── Emergency pause (issue #191) ─────────────────────────────────────────

    /// Wiring with an allowlisted, funded, approved token ready for `send`.
    fn setup_pausable_send() -> (
        Env,
        Address,
        GlobeWalletClient<'static>,
        Address,
        Address,
        Address,
        String,
        soroban_sdk::token::Client<'static>,
    ) {
        let (env, wallet_id, admin, client, wrapper_client) = setup_wiring();
        let token_admin = Address::generate(&env);
        let user = Address::generate(&env);
        let code = String::from_str(&env, "XLM");
        let (token_id, token_admin_client, token) =
            create_allowed_token(&env, &client, &admin, &token_admin);
        token_admin_client.mint(&user, &1_000);
        env.ledger().with_mut(|l| l.sequence_number = 100);
        wrapper_client.approve(&user, &wallet_id, &token_id, &1_000, &10_000, &None);
        let to = Address::generate(&env);
        (env, admin, client, user, token_id, to, code, token)
    }

    #[test]
    fn test_pauser_can_pause_and_send_fails_without_moving_tokens() {
        let (env, admin, client, user, token_id, to, _code, token) = setup_pausable_send();
        let pauser = Address::generate(&env);
        client.set_pauser(&admin, &Some(pauser.clone()));
        assert_eq!(client.pauser(), Some(pauser.clone()));
        assert!(!client.is_send_paused());

        client.pause_sends(&pauser);
        assert!(find_event(&env, "sends_paused").is_some());
        assert!(client.is_send_paused());

        assert_eq!(
            client.try_send(&user, &token_id, &to, &100),
            Err(Ok(WalletError::SendsPaused))
        );
        assert_eq!(token.balance(&user), 1_000);
        assert_eq!(token.balance(&to), 0);
        assert_eq!(client.get_spent_today(&user, &token_id), 0);
    }

    #[test]
    fn test_admin_can_pause_without_a_pauser() {
        let (_env, admin, client, ..) = setup_pausable_send();
        client.pause_sends(&admin);
        assert!(client.is_send_paused());
    }

    #[test]
    fn test_stranger_cannot_pause() {
        let (env, admin, client, ..) = setup_pausable_send();
        client.set_pauser(&admin, &Some(Address::generate(&env)));
        let stranger = Address::generate(&env);
        assert_eq!(client.try_pause_sends(&stranger), Err(Ok(WalletError::Unauthorized)));
        assert!(!client.is_send_paused());
    }

    #[test]
    fn test_pauser_cannot_unpause_but_admin_can() {
        let (env, admin, client, user, token_id, to, _code, token) = setup_pausable_send();
        let pauser = Address::generate(&env);
        client.set_pauser(&admin, &Some(pauser.clone()));
        client.pause_sends(&pauser);

        assert_eq!(client.try_unpause_sends(&pauser), Err(Ok(WalletError::Unauthorized)));
        assert!(client.is_send_paused());

        client.unpause_sends(&admin);
        assert!(find_event(&env, "sends_unpaused").is_some());
        assert!(!client.is_send_paused());

        client.send(&user, &token_id, &to, &100);
        assert_eq!(token.balance(&to), 100);
    }

    #[test]
    fn test_only_admin_can_set_pauser() {
        let (env, _admin, client, ..) = setup_pausable_send();
        let stranger = Address::generate(&env);
        assert_eq!(
            client.try_set_pauser(&stranger, &Some(stranger.clone())),
            Err(Ok(WalletError::Unauthorized))
        );
        assert_eq!(client.pauser(), None);
    }

    #[test]
    fn test_cleared_pauser_can_no_longer_pause() {
        let (env, admin, client, ..) = setup_pausable_send();
        let pauser = Address::generate(&env);
        client.set_pauser(&admin, &Some(pauser.clone()));
        client.set_pauser(&admin, &None);
        assert_eq!(client.try_pause_sends(&pauser), Err(Ok(WalletError::Unauthorized)));
    }

    #[test]
    fn test_pause_and_unpause_are_idempotent() {
        let (_env, admin, client, ..) = setup_pausable_send();
        client.unpause_sends(&admin); // not paused: no-op
        client.pause_sends(&admin);
        client.pause_sends(&admin); // already paused: no-op
        assert!(client.is_send_paused());
        client.unpause_sends(&admin);
        assert!(!client.is_send_paused());
    }

    #[test]
    fn test_recovery_still_works_while_sends_paused() {
        let (env, admin, guardians, client) = setup_with_guardians(3);
        client.set_recovery_config(&admin, &2u32, &GlobeWallet::MIN_RECOVERY_DELAY_LEDGERS);
        client.pause_sends(&admin);

        let new_admin = Address::generate(&env);
        client.initiate_recovery(&guardians.get(0).unwrap(), &new_admin);
        client.approve_recovery(&guardians.get(1).unwrap());
        let ready_at = client.recovery_proposal().unwrap().ready_at.unwrap();
        env.ledger().with_mut(|l| l.sequence_number = ready_at);
        client.execute_recovery();

        assert_eq!(client.admin(), new_admin);
        // The pause survives recovery, and the recovered admin can lift it.
        assert!(client.is_send_paused());
        assert_eq!(client.try_unpause_sends(&admin), Err(Ok(WalletError::Unauthorized)));
        client.unpause_sends(&new_admin);
        assert!(!client.is_send_paused());
    }

    #[test]
    fn test_admin_changes_still_work_while_sends_paused() {
        let (env, admin, client, ..) = setup_pausable_send();
        client.pause_sends(&admin);
        let candidate = Address::generate(&env);
        client.propose_admin(&admin, &candidate);
        client.accept_admin(&candidate);
        assert_eq!(client.admin(), candidate);
        assert!(client.is_send_paused());
    }

    #[test]
    fn test_send_rejects_when_token_wrapper_not_set() {
        let (env, _cid, admin, client) = setup();
        let user = Address::generate(&env);
        let to = Address::generate(&env);
        let _code = String::from_str(&env, "XLM");
        let token_admin = Address::generate(&env);
        let (token_id, _token_admin_client, _token) = create_allowed_token(&env, &client, &admin, &token_admin);
        // Deliberately never called set_token_wrapper.

        assert_eq!(
            client.try_send(&user, &token_id, &to, &100),
            Err(Ok(WalletError::TokenWrapperNotSet))
        );
    }

    #[test]
    fn test_send_over_daily_limit_fails_and_moves_no_tokens() {
        // Proves CEI ordering in practice: record_spend (the check) runs and
        // fails BEFORE transfer_from (the interaction) is ever attempted, so
        // a rejected send has zero effect on real token balances.
        let (env, wallet_id, admin, client, wrapper_client) = setup_wiring();
        let token_admin = Address::generate(&env);
        let user = Address::generate(&env);
        let to = Address::generate(&env);
        let (token_id, token_admin_client, token) = create_allowed_token(&env, &client, &admin, &token_admin);
        token_admin_client.mint(&user, &1_000);

        client.set_spend_limit(&user, &token_id, &100_i128);

        env.ledger().with_mut(|l| l.sequence_number = 100);
        wrapper_client.approve(&user, &wallet_id, &token_id, &500, &10_000, &None);

        assert_eq!(
            client.try_send(&user, &token_id, &to, &200),
            Err(Ok(WalletError::SpendLimitExceeded))
        );
        assert_eq!(token.balance(&user), 1_000, "no tokens should move on a rejected send");
        assert_eq!(token.balance(&to), 0);
        assert_eq!(
            wrapper_client.allowance(&user, &wallet_id, &token_id).amount,
            500,
            "allowance must be untouched — transfer_from was never reached"
        );
    }

    #[test]
    fn test_propose_allowed_token_requires_allowlist_role() {
        let (env, _wallet_id, _admin, client, _wrapper_client) = setup_wiring();
        let non_admin = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let (token_id, key) = create_sac(&env, &token_admin);
        assert_eq!(
            client.try_propose_allowed_token(
                &non_admin,
                &token_id,
                &String::from_str(&env, TEST_SAC_CODE),
                &Some(key),
            ),
            Err(Ok(WalletError::Unauthorized))
        );
        assert!(!client.is_token_allowed(&token_id));
        assert!(client.pending_allowed_token(&token_id).is_none());
    }

    #[test]
    fn test_remove_allowed_token() {
        let (env, _wallet_id, admin, client, _wrapper_client) = setup_wiring();
        let token_admin = Address::generate(&env);
        let (token_id, _tac, _t) = create_allowed_token(&env, &client, &admin, &token_admin);
        assert!(client.is_token_allowed(&token_id));
        assert!(client.allowed_token_info(&token_id).is_some());
        client.remove_allowed_token(&admin, &token_id);
        assert!(!client.is_token_allowed(&token_id));
        assert!(client.allowed_token_info(&token_id).is_none());
    }

    #[test]
    fn test_get_allowed_tokens_list() {
        let (env, _wallet_id, admin, client, _wrapper_client) = setup_wiring();
        assert_eq!(client.get_allowed_tokens().len(), 0);
        assert_eq!(client.allowed_tokens().len(), 0);

        let token_admin1 = Address::generate(&env);
        let (token_id1, key1) = create_sac(&env, &token_admin1);
        let token_admin2 = Address::generate(&env);
        let (token_id2, key2) = create_sac(&env, &token_admin2);

        allow_sac(&env, &client, &admin, &token_id1, &key1);
        allow_sac(&env, &client, &admin, &token_id2, &key2);

        let tokens = client.get_allowed_tokens();
        assert_eq!(tokens.len(), 2);
        assert_eq!(tokens.get(0).unwrap(), token_id1);
        assert_eq!(tokens.get(1).unwrap(), token_id2);

        // Re-proposing an already-allowed token is rejected, list unchanged.
        assert_eq!(
            client.try_propose_allowed_token(
                &admin,
                &token_id1,
                &String::from_str(&env, TEST_SAC_CODE),
                &Some(key1.clone()),
            ),
            Err(Ok(WalletError::AllowlistAlreadyPending))
        );
        assert_eq!(client.get_allowed_tokens().len(), 2);

        client.remove_allowed_token(&admin, &token_id1);
        let remaining = client.get_allowed_tokens();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining.get(0).unwrap(), token_id2);
    }

    // ── Issue #189: SAC verification + timelocked allowlist ──────────────────

    #[test]
    fn test_allowlist_stores_verified_sac_metadata() {
        let (env, _wallet_id, admin, client, _wrapper_client) = setup_wiring();
        let (token_id, key) = create_sac(&env, &Address::generate(&env));
        allow_sac(&env, &client, &admin, &token_id, &key);
        // Events first: soroban-sdk 22+ only keeps the latest invocation's.
        let (topics, data) = find_event(&env, "token_allowed").expect("token_allowed");
        assert_eq!(u32::try_from_val(&env, &topics.get(1).unwrap()).unwrap(), EVENT_VERSION);
        let ev = TokenAllowedEvent::try_from_val(&env, &data).unwrap();
        assert_eq!(ev.token_id, token_id);
        assert_eq!(ev.executed_by, admin);
        let info = client.allowed_token_info(&token_id).unwrap();
        assert_eq!(info.token_id, token_id);
        assert_eq!(info.asset_code, String::from_str(&env, TEST_SAC_CODE));
        assert_eq!(info.issuer_key, IssuerKey::Key(key));
    }

    #[test]
    fn test_allowlist_timelock_enforced() {
        let (env, _wallet_id, admin, client, _wrapper_client) = setup_wiring();
        let (token_id, key) = create_sac(&env, &Address::generate(&env));
        env.ledger().with_mut(|l| l.sequence_number = 1_000);
        client.propose_allowed_token(
            &admin,
            &token_id,
            &String::from_str(&env, TEST_SAC_CODE),
            &Some(key.clone()),
        );
        assert!(find_event(&env, "token_allowlist_proposed").is_some());
        let pending = client.pending_allowed_token(&token_id).unwrap();
        assert_eq!(pending.ready_at, 1_000 + GlobeWallet::ALLOWLIST_DELAY_LEDGERS);
        assert_eq!(pending.proposed_by, admin);

        // Not usable, not executable, until the delay elapses.
        assert!(!client.is_token_allowed(&token_id));
        assert_eq!(
            client.try_execute_allowed_token(&admin, &token_id),
            Err(Ok(WalletError::AllowlistNotReady))
        );
        env.ledger().with_mut(|l| l.sequence_number = pending.ready_at - 1);
        assert_eq!(
            client.try_execute_allowed_token(&admin, &token_id),
            Err(Ok(WalletError::AllowlistNotReady))
        );
        env.ledger().with_mut(|l| l.sequence_number = pending.ready_at);
        client.execute_allowed_token(&admin, &token_id);
        assert!(client.is_token_allowed(&token_id));
        assert!(client.pending_allowed_token(&token_id).is_none());
    }

    #[test]
    fn test_allowlist_cancel_and_execute_without_proposal() {
        let (env, _wallet_id, admin, client, _wrapper_client) = setup_wiring();
        let (token_id, key) = create_sac(&env, &Address::generate(&env));
        assert_eq!(
            client.try_execute_allowed_token(&admin, &token_id),
            Err(Ok(WalletError::AllowlistProposalNotFound))
        );
        assert_eq!(
            client.try_cancel_allowed_token(&admin, &token_id),
            Err(Ok(WalletError::AllowlistProposalNotFound))
        );
        client.propose_allowed_token(
            &admin,
            &token_id,
            &String::from_str(&env, TEST_SAC_CODE),
            &Some(key),
        );
        client.cancel_allowed_token(&admin, &token_id);
        assert!(find_event(&env, "token_allowlist_cancelled").is_some());
        assert!(client.pending_allowed_token(&token_id).is_none());
        assert_eq!(
            client.try_execute_allowed_token(&admin, &token_id),
            Err(Ok(WalletError::AllowlistProposalNotFound))
        );
    }

    #[test]
    fn test_allowlist_rejects_non_sac_contract_claiming_familiar_name() {
        // A custom token contract (e.g. fee-on-transfer, no-op or
        // callback-driven) proposed under a familiar code like "USDC" can
        // never match the SAC address derived from that asset.
        let (env, _wallet_id, admin, client, _wrapper_client) = setup_wiring();
        let evil_id = env.register_contract(None, MaliciousToken);
        let (_real_sac, real_issuer) = create_sac(&env, &Address::generate(&env));
        for (code, issuer) in [
            ("USDC", Some(real_issuer.clone())),
            ("aaa", Some(real_issuer.clone())),
            ("XLM", None),
        ] {
            assert_eq!(
                client.try_propose_allowed_token(
                    &admin,
                    &evil_id,
                    &String::from_str(&env, code),
                    &issuer,
                ),
                Err(Ok(WalletError::TokenNotStellarAsset))
            );
        }
        assert!(!client.is_token_allowed(&evil_id));
        assert!(client.pending_allowed_token(&evil_id).is_none());
    }

    #[test]
    fn test_allowlist_rejects_real_sac_with_wrong_identity() {
        // A real SAC proposed with the wrong code or issuer is rejected too,
        // so stored metadata always describes the asset actually wrapped.
        let (env, _wallet_id, admin, client, _wrapper_client) = setup_wiring();
        let (token_id, key) = create_sac(&env, &Address::generate(&env));
        let (_other, other_key) = create_sac(&env, &Address::generate(&env));
        assert_eq!(
            client.try_propose_allowed_token(&admin, &token_id, &String::from_str(&env, "aab"), &Some(key)),
            Err(Ok(WalletError::TokenNotStellarAsset))
        );
        assert_eq!(
            client.try_propose_allowed_token(
                &admin,
                &token_id,
                &String::from_str(&env, TEST_SAC_CODE),
                &Some(other_key)
            ),
            Err(Ok(WalletError::TokenNotStellarAsset))
        );
    }

    #[test]
    fn test_allowlist_validates_asset_code() {
        let (env, _wallet_id, admin, client, _wrapper_client) = setup_wiring();
        let (token_id, key) = create_sac(&env, &Address::generate(&env));
        for bad in ["", "THIRTEENCHARS", "US-D"] {
            assert_eq!(
                client.try_propose_allowed_token(&admin, &token_id, &String::from_str(&env, bad), &Some(key.clone())),
                Err(Ok(WalletError::InvalidAssetCode))
            );
        }
        // No issuer means native XLM; any other code is malformed.
        assert_eq!(
            client.try_propose_allowed_token(&admin, &token_id, &String::from_str(&env, "USDC"), &None),
            Err(Ok(WalletError::InvalidAssetInfo))
        );
    }

    #[test]
    fn test_native_xlm_derivation_matches_host() {
        // The native asset XDR is `ASSET_TYPE_NATIVE` (u32 0).
        let (env, wallet_id, _admin, _client) = setup();
        env.as_contract(&wallet_id, || {
            let derived = GlobeWallet::derive_sac_address(&env, &String::from_str(&env, "XLM"), &None).unwrap();
            let expected = env
                .deployer()
                .with_stellar_asset(Bytes::from_array(&env, &[0, 0, 0, 0]))
                .deployed_address();
            assert_eq!(derived, expected);
        });
    }

    #[test]
    fn test_execute_allowed_token_requires_allowlist_role() {
        let (env, _wallet_id, admin, client, _wrapper_client) = setup_wiring();
        let (token_id, key) = create_sac(&env, &Address::generate(&env));
        client.propose_allowed_token(&admin, &token_id, &String::from_str(&env, TEST_SAC_CODE), &Some(key));
        let ready_at = client.pending_allowed_token(&token_id).unwrap().ready_at;
        env.ledger().with_mut(|l| l.sequence_number = ready_at);
        let pauser = Address::generate(&env);
        client.grant_role(&admin, &Role::Pauser, &pauser);
        assert_eq!(
            client.try_execute_allowed_token(&pauser, &token_id),
            Err(Ok(WalletError::Unauthorized))
        );
        assert_eq!(
            client.try_cancel_allowed_token(&pauser, &token_id),
            Err(Ok(WalletError::Unauthorized))
        );
        assert_eq!(
            client.try_remove_allowed_token(&pauser, &token_id),
            Err(Ok(WalletError::Unauthorized))
        );
    }

    // ── Issue #190: role separation ──────────────────────────────────────────

    #[test]
    fn test_allowlist_manager_role_can_curate_but_not_upgrade_or_pause() {
        let (env, _wallet_id, admin, client, _wrapper_client) = setup_wiring();
        let manager = Address::generate(&env);
        client.grant_role(&admin, &Role::AllowlistManager, &manager);
        assert!(client.has_role(&Role::AllowlistManager, &manager));
        assert!(!client.has_role(&Role::Upgrader, &manager));

        let (token_id, key) = create_sac(&env, &Address::generate(&env));
        allow_sac(&env, &client, &manager, &token_id, &key);
        assert!(client.is_token_allowed(&token_id));

        let hash = BytesN::from_array(&env, &[7u8; 32]);
        assert_eq!(
            client.try_propose_upgrade(&manager, &hash, &GlobeWallet::MIN_UPGRADE_DELAY_LEDGERS),
            Err(Ok(WalletError::Unauthorized))
        );
        assert_eq!(client.try_pause(&manager), Err(Ok(WalletError::Unauthorized)));
        // Role holders cannot manage roles or other admin-only config.
        assert_eq!(
            client.try_grant_role(&manager, &Role::Upgrader, &manager),
            Err(Ok(WalletError::Unauthorized))
        );
        assert_eq!(
            client.try_set_token_wrapper(&manager, &Address::generate(&env)),
            Err(Ok(WalletError::Unauthorized))
        );
    }

    #[test]
    fn test_upgrader_role_can_propose_upgrade_but_not_curate_or_pause() {
        let (env, _cid, admin, client) = setup();
        let upgrader = Address::generate(&env);
        client.grant_role(&admin, &Role::Upgrader, &upgrader);
        let hash = BytesN::from_array(&env, &[9u8; 32]);
        client.propose_upgrade(&upgrader, &hash, &GlobeWallet::MIN_UPGRADE_DELAY_LEDGERS);
        assert_eq!(client.pending_upgrade().unwrap().proposed_by, upgrader);

        let token_id = Address::generate(&env);
        assert_eq!(
            client.try_propose_allowed_token(&upgrader, &token_id, &String::from_str(&env, "XLM"), &None),
            Err(Ok(WalletError::Unauthorized))
        );
        assert_eq!(client.try_pause(&upgrader), Err(Ok(WalletError::Unauthorized)));
    }

    #[test]
    fn test_pauser_role_blocks_send_and_cannot_upgrade() {
        let (env, wallet_id, admin, client, wrapper_client) = setup_wiring();
        let pauser = Address::generate(&env);
        client.grant_role(&admin, &Role::Pauser, &pauser);
        let user = Address::generate(&env);
        let to = Address::generate(&env);
        let _code = String::from_str(&env, "XLM");
        let (token_id, token_admin_client, token) =
            create_allowed_token(&env, &client, &admin, &Address::generate(&env));
        token_admin_client.mint(&user, &1_000);
        env.ledger().with_mut(|l| l.sequence_number = 100);
        wrapper_client.approve(&user, &wallet_id, &token_id, &500, &10_000, &None);

        client.pause(&pauser);
        let (_, data) = find_event(&env, "pause_changed").expect("pause_changed");
        assert!(client.is_paused());
        assert!(PauseChangedEvent::try_from_val(&env, &data).unwrap().paused);
        assert_eq!(
            client.try_send(&user, &token_id, &to, &100),
            Err(Ok(WalletError::ContractPaused))
        );
        assert_eq!(token.balance(&to), 0);

        let hash = BytesN::from_array(&env, &[3u8; 32]);
        assert_eq!(
            client.try_propose_upgrade(&pauser, &hash, &GlobeWallet::MIN_UPGRADE_DELAY_LEDGERS),
            Err(Ok(WalletError::Unauthorized))
        );

        client.unpause(&pauser);
        assert!(!client.is_paused());
        client.send(&user, &token_id, &to, &100);
        assert_eq!(token.balance(&to), 100);
    }

    #[test]
    fn test_revoked_role_is_rejected_and_events_emitted() {
        let (env, _cid, admin, client) = setup();
        let pauser = Address::generate(&env);
        client.grant_role(&admin, &Role::Pauser, &pauser);
        let (_, data) = find_event(&env, "role_granted").expect("role_granted");
        let granted = RoleGrantedEvent::try_from_val(&env, &data).unwrap();
        assert_eq!(granted.role, Role::Pauser);
        assert_eq!(granted.account, pauser);

        client.revoke_role(&admin, &Role::Pauser, &pauser);
        assert!(find_event(&env, "role_revoked").is_some());
        assert!(!client.has_role(&Role::Pauser, &pauser));
        assert_eq!(client.try_pause(&pauser), Err(Ok(WalletError::Unauthorized)));
        // Admin implicitly holds every role.
        assert!(client.has_role(&Role::Pauser, &admin));
        client.pause(&admin);
        assert!(client.is_paused());
    }

    #[test]
    fn test_non_admin_cannot_grant_or_revoke_roles() {
        let (env, _cid, admin, client) = setup();
        let outsider = Address::generate(&env);
        let holder = Address::generate(&env);
        assert_eq!(
            client.try_grant_role(&outsider, &Role::Upgrader, &outsider),
            Err(Ok(WalletError::Unauthorized))
        );
        client.grant_role(&admin, &Role::Upgrader, &holder);
        assert_eq!(
            client.try_revoke_role(&outsider, &Role::Upgrader, &holder),
            Err(Ok(WalletError::Unauthorized))
        );
        assert!(client.has_role(&Role::Upgrader, &holder));
    }

    // ── Issue #192: versioned event topics ───────────────────────────────────

    #[test]
    fn test_every_event_carries_name_and_version_topics() {
        let (env, _cid, admin, client) = setup();
        let user = Address::generate(&env);
        client.add_asset(&user, &xlm(&env));
        client.grant_role(&admin, &Role::Pauser, &user);
        let mut seen = 0;
        for (_contract_id, topics, _data) in all_events(&env) {
            assert_eq!(topics.len(), 2, "topics must be (name, version)");
            assert!(Symbol::try_from_val(&env, &topics.get(0).unwrap()).is_ok());
            assert_eq!(u32::try_from_val(&env, &topics.get(1).unwrap()).unwrap(), EVENT_VERSION);
            seen += 1;
        }
        assert!(seen > 0);
    }

    #[test]
    fn test_legacy_tuple_payload_shapes_are_frozen_for_v1() {
        // Compatibility guard: v1 payloads documented in docs/events.md as
        // tuples must keep decoding as those tuples. Changing any of them
        // requires bumping EVENT_VERSION.
        let (env, _cid, admin, client) = setup();
        let user = Address::generate(&env);
        let code = String::from_str(&env, "XLM");
        let code_token = Address::generate(&env);
        // `events().all()` only reliably covers the latest invocation, so
        // decode each payload right after the call that published it.
        client.add_asset(&user, &xlm(&env));
        let (_, d) = find_event(&env, "asset_added").unwrap();
        assert_eq!(<(Address, String)>::try_from_val(&env, &d).unwrap(), (user.clone(), code.clone()));
        client.set_spend_limit(&user, &code_token, &10_i128);
        let (_, d) = find_event(&env, "spend_limit_set").unwrap();
        assert_eq!(
            <(Address, String, i128)>::try_from_val(&env, &d).unwrap(),
            (user.clone(), code.clone(), 10)
        );
        let candidate = Address::generate(&env);
        client.propose_admin(&admin, &candidate);
        let (_, d) = find_event(&env, "admin_proposed").unwrap();
        assert_eq!(<(Address, Address)>::try_from_val(&env, &d).unwrap(), (admin, candidate));
        assert_eq!(EVENT_VERSION, 1);
    }

    // ── Issue #193: frozen error discriminants ───────────────────────────────

    #[test]
    fn test_error_discriminants_match_snapshot() {
        let snapshot = include_str!("../error-codes.snapshot.json");
        let mut max_code = 0u32;
        let mut count = 0u32;
        for line in snapshot.lines() {
            let line = line.trim().trim_end_matches(',');
            if !line.starts_with('"') {
                continue;
            }
            let mut parts = line.splitn(2, ':');
            let name = parts.next().unwrap().trim().trim_matches('"');
            let code: u32 = parts.next().unwrap().trim().parse().unwrap();
            let err = WalletError::try_from(soroban_sdk::Error::from_contract_error(code))
                .unwrap_or_else(|_| panic!("snapshot code {} ({}) no longer exists in WalletError", code, name));
            assert_eq!(
                std::format!("{:?}", err),
                name,
                "discriminant {} changed meaning; error codes are frozen (see error-codes.snapshot.json)",
                code
            );
            max_code = max_code.max(code);
            count += 1;
        }
        assert!(count > 0);
        // Every code 1001..=max is pinned, and nothing exists past the
        // snapshot: a new variant must be appended to the snapshot too.
        assert_eq!(count, max_code - 1000);
        assert!(
            WalletError::try_from(soroban_sdk::Error::from_contract_error(max_code + 1)).is_err(),
            "new WalletError variant {} is missing from error-codes.snapshot.json",
            max_code + 1
        );
    }

    #[test]
    fn test_set_token_wrapper_requires_admin() {
        let (env, _cid, _admin, client) = setup();
        let non_admin = Address::generate(&env);
        let wrapper_id = Address::generate(&env);
        assert_eq!(
            client.try_set_token_wrapper(&non_admin, &wrapper_id),
            Err(Ok(WalletError::Unauthorized))
        );
        assert_eq!(client.get_token_wrapper(), None);
    }

    // ── The centerpiece: a real, adversarial mock token contract ─────────────
    //
    // `MaliciousToken` implements just enough of the standard token
    // interface (`transfer`) for `token-wrapper::transfer_from`'s
    // `token::Client::transfer` call to route to it — exactly as it would
    // for any real SAC, since token_id is caller-supplied and unconstrained
    // beyond the allowlist check. Its `transfer` implementation, instead of
    // moving any value, immediately tries to call back into
    // `GlobeWallet::record_spend` for the same (victim, asset_code) pair —
    // the exact double-count scenario issue #92 describes. If Soroban's
    // reentry protection did not hold for this 3-hop chain, that call would
    // succeed and the assertions below would catch the resulting
    // double-counted DailySpent entry.

    #[contract]
    pub struct MaliciousToken;

    #[contractimpl]
    impl MaliciousToken {
        pub fn init(env: Env, wallet_id: Address, victim: Address, token_id: Address) {
            env.storage().instance().set(&Symbol::new(&env, "wallet"), &wallet_id);
            env.storage().instance().set(&Symbol::new(&env, "victim"), &victim);
            env.storage().instance().set(&Symbol::new(&env, "code"), &token_id);
        }

        /// Matches the standard token interface's `transfer` signature so
        /// `token::Client::transfer` (called by token-wrapper) routes here.
        pub fn transfer(env: Env, _from: Address, _to: Address, amount: i128) {
            let wallet_id: Address = env.storage().instance().get(&Symbol::new(&env, "wallet")).unwrap();
            let victim: Address = env.storage().instance().get(&Symbol::new(&env, "victim")).unwrap();
            let code: Address = env.storage().instance().get(&Symbol::new(&env, "code")).unwrap();
            // Attempt the exact reentrant callback issue #92 describes: a
            // second record_spend for the same (victim, asset_code) pair,
            // from inside the token's own transfer, before the outer
            // send/transfer_from call chain has unwound. Per
            // docs/design/wiring-reentrancy-threat-model.md §3.1, the host
            // must reject this because GlobeWallet's frame (the root of this
            // whole call chain) is still active on the stack.
            let victim_client = GlobeWalletClient::new(&env, &wallet_id);
            victim_client.record_spend(&victim, &code, &amount);
            // If we ever get here, the reentrant call above did NOT panic —
            // i.e. reentry protection failed to hold. Nothing further to do;
            // the test asserts on the resulting DailySpent state instead of
            // relying on this being unreachable, so a silent protocol change
            // that made this callback a no-op would still be caught.
        }
    }

    #[test]
    fn test_send_rejects_reentrant_malicious_token() {
        let (env, wallet_id, admin, client) = setup();
        let wrapper_id = env.register_contract(None, token_wrapper::TokenWrapper);
        let wrapper_client = token_wrapper::TokenWrapperClient::new(&env, &wrapper_id);
        client.set_token_wrapper(&admin, &wrapper_id);

        let user = Address::generate(&env);
        let to = Address::generate(&env);
        let evil_id = env.register_contract(None, MaliciousToken);
        let evil_client = MaliciousTokenClient::new(&env, &evil_id);
        evil_client.init(&wallet_id, &user, &evil_id);
        let _code = evil_id.clone();
        let code_token = Address::generate(&env);

        // Since issue #189 a non-SAC can no longer pass `propose_allowed_token`
        // (see `test_allowlist_rejects_non_sac_contract_claiming_familiar_name`).
        // This test keeps proving the *second* line of defense — host reentry
        // protection — by simulating an allowlist bypass with a direct write.
        env.as_contract(&wallet_id, || {
            env.storage()
                .persistent()
                .set(&DataKey::AllowedToken(evil_id.clone()), &true);
        });
        client.set_spend_limit(&user, &code_token, &1_000_000_i128);

        env.ledger().with_mut(|l| l.sequence_number = 100);
        wrapper_client.approve(&user, &wallet_id, &evil_id, &1_000, &10_000, &None);

        // The reentrant callback inside MaliciousToken::transfer must be
        // rejected by the host, which must fail transfer_from's call into
        // it, which must fail send() as a whole — never a silent success.
        let result = client.try_send(&user, &evil_id, &to, &100);
        assert!(
            result.is_err(),
            "send() must fail when the token contract attempts to re-enter GlobeWallet, not silently succeed"
        );

        // And the transaction-atomicity guarantee: since the whole call
        // failed, record_spend's own (legitimate) write inside `send` must
        // also have been rolled back — not just the reentrant one. There
        // must be no SpendWindow entry at all, proving neither the intended
        // spend nor a reentrant double-spend was left committed.
        env.as_contract(&wallet_id, || {
            let key = DataKey::SpendWindow(user.clone(), code_token.clone());
            let record: Option<SpendWindow> = env.storage().persistent().get(&key);
            assert!(
                record.is_none(),
                "no SpendWindow entry should survive a fully-reverted transaction; found {:?}",
                record
            );
        });

        // The spend limit configuration itself (untouched by this call
        // either way) confirms setup was correct and we're not passing
        // vacuously because the limit was never configured.
        assert_eq!(client.get_spend_limit(&user, &code_token), 1_000_000);
    }

    // ── Archival fails safe (issue #185) ────────────────────────────────

    /// Simulates archival of the `SpendLimit` entry by deleting it out from
    /// under the contract; the opt-in marker survives, so the spend must be
    /// rejected rather than treated as unlimited.
    #[test]
    fn test_archived_spend_limit_fails_safe() {
        let (env, cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let code_token = Address::generate(&env);
        client.set_spend_limit(&user, &code_token, &100_i128);
        env.as_contract(&cid, || {
            env.storage()
                .persistent()
                .remove(&DataKey::TokenSpendLimit(user.clone(), code_token.clone()));
        });
        assert!(client.is_limit_archived(&user, &code_token));
        assert_eq!(
            client.try_record_spend(&user, &code_token, &1_000_000_i128),
            Err(Ok(WalletError::SpendLimitArchived))
        );
        assert_eq!(
            client.try_get_spend_limit(&user, &code_token),
            Err(Ok(soroban_sdk::Error::from_contract_error(
                WalletError::SpendLimitArchived as u32
            )))
        );
    }

    #[test]
    fn test_cleared_limit_removes_opt_in_marker() {
        let (env, cid, _admin, client) = setup();
        let user = Address::generate(&env);
        let code_token = Address::generate(&env);
        client.set_spend_limit(&user, &code_token, &100_i128);
        // Clearing is an increase (#176): queued, so the marker survives
        // until the delay elapses and the pending limit is promoted.
        client.set_spend_limit(&user, &code_token, &0_i128);
        env.as_contract(&cid, || {
            assert!(env
                .storage()
                .persistent()
                .has(&DataKey::LimitOptIn(user.clone(), code_token.clone())));
        });
        env.ledger()
            .with_mut(|l| l.timestamp += SPEND_LIMIT_INCREASE_DELAY_SECS);
        client.record_spend(&user, &code_token, &1_i128);
        env.as_contract(&cid, || {
            assert!(!env
                .storage()
                .persistent()
                .has(&DataKey::LimitOptIn(user.clone(), code_token.clone())));
            assert!(!env
                .storage()
                .persistent()
                .has(&DataKey::TokenSpendLimit(user.clone(), code_token.clone())));
        });
        // Never opted in (any more) → missing entry really means unlimited.
        assert!(!client.is_limit_archived(&user, &code_token));
        client.record_spend(&user, &code_token, &1_000_000_i128);
    }

    #[test]
    fn test_extend_user_ttl_keeps_entries_alive() {
        let (env, _cid, admin, client) = setup();
        let user = Address::generate(&env);
        // extend_user_ttl walks the allowlisted tokens (spend state is
        // token-keyed), so the limit must be on an allowlisted token.
        let token_admin = Address::generate(&env);
        let (code_token, _, _) = create_allowed_token(&env, &client, &admin, &token_admin);
        client.add_asset(&user, &xlm(&env));
        client.set_spend_limit(&user, &code_token, &1_000_i128);
        client.record_spend(&user, &code_token, &10_i128);
        // UserAssets + TokenSpendLimit + LimitOptIn + SpendWindow
        assert_eq!(client.extend_user_ttl(&user), 4);
        for _ in 0..3 {
            env.ledger().with_mut(|l| l.sequence_number += GlobeWallet::KEEPER_INTERVAL_LEDGERS);
            client.extend_user_ttl(&user);
        }
        assert_eq!(client.get_spend_limit(&user, &code_token), 1_000);
        assert_eq!(client.get_assets(&user).len(), 1);
    }

    #[test]
    fn test_extend_user_ttl_unknown_user_is_noop() {
        let (env, _cid, _admin, client) = setup();
        let user = Address::generate(&env);
        assert_eq!(client.extend_user_ttl(&user), 0);
    }
}
