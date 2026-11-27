import type { ApiClient } from "../client";
import type { AccountId } from "../types";
import type { PendingUpgrade } from "./config";
import type { SubmitPending, SubmitResult } from "./multisig";

/**
 * /api/v1/contract — the globe-wallet Soroban smart wallet
 * (backend/src/routes/contract.ts, contract/contracts/globe-wallet).
 * Reads are public; the `.../build` routes and submit need a session for
 * the account named in the body.
 *
 * Contract semantics the UI relies on:
 * - Spend limits are a rolling 24 h cap per asset, in stroops; 0 = unlimited.
 *   Decreases apply at once; increases (and switching to unlimited) are
 *   queued for 24 h and can be cancelled meanwhile (issue #176).
 * - Guardians and the recovery config are contract-wide. Once recovery is
 *   configured, guardian adds/removes are queued for the recovery delay,
 *   and the guardian set is frozen while a recovery proposal is pending.
 * - Recovery: a guardian initiates, guardians approve until the threshold,
 *   then a timelock of `delayInLedgers` runs before anyone can execute.
 *   The admin can cancel early in the timelock (issue #175).
 */

/** An asset on the user's wallet whitelist. `issuer` is null for XLM. */
export interface ContractAsset {
  code: string;
  issuer: string | null;
}

/** Rolling 24 h spend allowance for one asset (amounts are stroop strings). */
export interface SpendAllowance {
  assetCode: string;
  /** True when no limit is configured (contract limit of 0). */
  unlimited: boolean;
  /** Cap in stroops; "0" when unlimited. */
  limit: string;
  spent: string;
  /** `limit - spent` floored at "0"; null when unlimited. */
  remaining: string | null;
  windowStartsAt: string;
  windowResetsAt: string;
  /** When the oldest counted spend rolls off; null when nothing is counted. */
  nextRefillAt: string | null;
}

export interface RecoveryConfig {
  /** Guardian approvals required for quorum. */
  threshold: number;
  /** Ledgers between reaching quorum and execution unlocking. */
  delayInLedgers: number;
}

export interface RecoveryProposal {
  newAdmin: AccountId;
  approvals: AccountId[];
  approvalsCount: number;
  threshold: number | null;
  approvalsRemaining: number | null;
  quorumReached: boolean;
  /** Ledger at which execution unlocks; null until quorum is reached. */
  readyAtLedger: number | null;
  latestLedger: number | null;
  ledgersRemaining: number | null;
  /** Estimated ISO time execution unlocks (~5 s per ledger). */
  executableAt: string | null;
  executable: boolean;
}

/** GET /wallet/recovery — guardians, config and the active proposal in one go. */
export interface RecoveryState {
  guardians: AccountId[];
  guardianCount: number;
  config: RecoveryConfig | null;
  configured: boolean;
  proposal: RecoveryProposal | null;
}

export interface ContractStatus {
  sendsPaused: boolean;
  pauser: AccountId | null;
}

export interface AdminState {
  admin: AccountId;
  pendingAdmin: AccountId | null;
}

/** A simulated, assembled Soroban invocation ready for the wallet to sign. */
export interface PreparedInvocation {
  xdr: string;
  networkPassphrase: string;
  fee: string;
  sequence: string;
  timeBounds: { minTime: string; maxTime: string };
  expiresAt: string | null;
  minResourceFee: string;
  authEntries: string[];
  latestLedger: number;
  /** Archived state to restore first: sign and submit this before `xdr`. */
  restore?: { transactionXdr: string; hash: string; minResourceFee: string };
}

/** Builds that only return the envelope (admin transfer, asset whitelist). */
export interface UnsignedXdr {
  xdr: string;
}

export function contractApi(client: ApiClient) {
  const base = "/api/v1/contract";
  const wallet = (publicKey: AccountId) => `${base}/wallet/${encodeURIComponent(publicKey)}`;

  return {
    // ── Reads (public) ───────────────────────────────────────────────────
    status(signal?: AbortSignal) {
      return client.get<ContractStatus>(`${base}/status`, { auth: false, signal });
    },

    admin(signal?: AbortSignal) {
      return client.get<AdminState>(`${base}/admin`, { auth: false, signal });
    },

    async pendingUpgrade(signal?: AbortSignal): Promise<PendingUpgrade | null> {
      const { pendingUpgrade } = await client.get<{ pendingUpgrade: PendingUpgrade | null }>(`${base}/upgrade`, {
        auth: false,
        signal,
      });
      return pendingUpgrade;
    },

    async assets(publicKey: AccountId, signal?: AbortSignal): Promise<ContractAsset[]> {
      const { assets } = await client.get<{ assets: ContractAsset[] }>(`${wallet(publicKey)}/assets`, {
        auth: false,
        signal,
      });
      return assets;
    },

    async spendAllowances(publicKey: AccountId, signal?: AbortSignal): Promise<SpendAllowance[]> {
      const { allowances } = await client.get<{ allowances: SpendAllowance[] }>(
        `${wallet(publicKey)}/spend-allowance`,
        { auth: false, signal },
      );
      return allowances;
    },

    spendAllowance(publicKey: AccountId, assetCode: string, signal?: AbortSignal) {
      return client.get<SpendAllowance>(`${wallet(publicKey)}/spend-allowance/${encodeURIComponent(assetCode)}`, {
        auth: false,
        signal,
      });
    },

    async guardians(signal?: AbortSignal): Promise<AccountId[]> {
      const { guardians } = await client.get<{ guardians: AccountId[] }>(`${base}/wallet/guardians`, {
        auth: false,
        signal,
      });
      return guardians;
    },

    recovery(signal?: AbortSignal) {
      return client.get<RecoveryState>(`${base}/wallet/recovery`, { auth: false, signal });
    },

    // ── Builds (session for the acting account) ──────────────────────────
    buildAddAsset(user: AccountId, asset: ContractAsset) {
      return client.post<UnsignedXdr>(`${base}/wallet/assets/build`, { user, asset });
    },

    buildRemoveAsset(user: AccountId, assetCode: string) {
      return client.post<UnsignedXdr>(`${base}/wallet/assets/remove/build`, { user, assetCode });
    },

    /** `limit` is a decimal asset amount ("0" = unlimited). */
    buildSetSpendLimit(user: AccountId, assetCode: string, limit: string) {
      return client.post<PreparedInvocation>(`${base}/wallet/spend-limit/build`, { user, assetCode, limit });
    },

    buildAddGuardian(admin: AccountId, guardian: AccountId) {
      return client.post<PreparedInvocation>(`${base}/wallet/guardians/add/build`, { admin, guardian });
    },

    buildRemoveGuardian(admin: AccountId, guardian: AccountId) {
      return client.post<PreparedInvocation>(`${base}/wallet/guardians/remove/build`, { admin, guardian });
    },

    buildInitiateRecovery(guardian: AccountId, newAdmin: AccountId) {
      return client.post<PreparedInvocation>(`${base}/wallet/recovery/initiate/build`, { guardian, newAdmin });
    },

    buildApproveRecovery(guardian: AccountId) {
      return client.post<PreparedInvocation>(`${base}/wallet/recovery/approve/build`, { guardian });
    },

    buildRevokeRecoveryApproval(guardian: AccountId) {
      return client.post<PreparedInvocation>(`${base}/wallet/recovery/revoke-approval/build`, { guardian });
    },

    /** Execution is permissionless; the caller pays the fee. */
    buildExecuteRecovery(sourcePublicKey: AccountId) {
      return client.post<PreparedInvocation>(`${base}/wallet/recovery/execute/build`, { sourcePublicKey });
    },

    buildCancelRecovery(admin: AccountId) {
      return client.post<PreparedInvocation>(`${base}/wallet/recovery/cancel/build`, { admin });
    },

    buildProposeAdmin(currentAdmin: AccountId, candidate: AccountId) {
      return client.post<UnsignedXdr>(`${base}/admin/propose`, { currentAdmin, candidate });
    },

    buildAcceptAdmin(candidate: AccountId) {
      return client.post<UnsignedXdr>(`${base}/admin/accept`, { candidate });
    },

    buildCancelAdminTransfer(currentAdmin: AccountId) {
      return client.post<UnsignedXdr>(`${base}/admin/cancel`, { currentAdmin });
    },

    /** Submit a signed envelope from any build above (202 + hash if still undecided). */
    submit(signedXdr: string) {
      return client.post<SubmitResult | SubmitPending>(`${base}/wallet/submit`, { signedXdr });
    },
  };
}

export type ContractApi = ReturnType<typeof contractApi>;
