import { formatDuration, ledgersToMs, msUntil } from "@/lib/countdown";
import type { RecoveryState } from "@/lib/api/endpoints/contract";

/**
 * Social-recovery lifecycle of the globe-wallet contract, turned into a
 * timeline and per-role permissions for the UI:
 *
 *   initiate (a guardian) → approvals until threshold → timelock
 *   (`delayInLedgers`, armed when quorum is first reached) → execute (anyone)
 *
 * Guardians may revoke their approval; dropping below the threshold disarms
 * the timelock. The admin may cancel before quorum, or during the first half
 * of the timelock, but never once ≥ 2/3 of all guardians approved (#175).
 */

export type StepStatus = "done" | "current" | "upcoming";

export interface TimelineStep {
  id: "initiated" | "approvals" | "timelock" | "executable";
  title: string;
  detail: string;
  status: StepStatus;
}

export function recoveryTimeline(state: RecoveryState, now: number = Date.now()): TimelineStep[] {
  const proposal = state.proposal;
  const threshold = proposal?.threshold ?? state.config?.threshold ?? null;
  const delay = state.config?.delayInLedgers ?? null;
  const delayText = delay !== null ? `about ${formatDuration(ledgersToMs(delay))}` : "the configured delay";

  if (!proposal) {
    return [
      { id: "initiated", title: "Initiate", detail: "A guardian proposes a new admin key.", status: "current" },
      {
        id: "approvals",
        title: "Guardian approvals",
        detail: threshold !== null ? `${threshold} guardian approvals are needed.` : "Guardians approve the proposal.",
        status: "upcoming",
      },
      { id: "timelock", title: "Timelock", detail: `Waits ${delayText} once approved.`, status: "upcoming" },
      { id: "executable", title: "Execute", detail: "Anyone can then hand the wallet to the new admin.", status: "upcoming" },
    ];
  }

  const quorum = proposal.quorumReached;
  const approvalsDetail =
    threshold !== null
      ? `${proposal.approvalsCount} of ${threshold} approvals${quorum ? "" : ` (${proposal.approvalsRemaining ?? 0} to go)`}.`
      : `${proposal.approvalsCount} approvals.`;

  let timelockDetail = `Starts when the threshold is reached and lasts ${delayText}.`;
  if (quorum && !proposal.executable) {
    timelockDetail = proposal.executableAt
      ? `Unlocks in ${formatDuration(msUntil(proposal.executableAt, now))}.`
      : proposal.ledgersRemaining !== null
        ? `Unlocks in ${proposal.ledgersRemaining} ledgers.`
        : "Running.";
  } else if (proposal.executable) {
    timelockDetail = "Elapsed.";
  }

  return [
    {
      id: "initiated",
      title: "Initiated",
      detail: `New admin proposed: ${proposal.newAdmin}.`,
      status: "done",
    },
    { id: "approvals", title: "Guardian approvals", detail: approvalsDetail, status: quorum ? "done" : "current" },
    {
      id: "timelock",
      title: "Timelock",
      detail: timelockDetail,
      status: proposal.executable ? "done" : quorum ? "current" : "upcoming",
    },
    {
      id: "executable",
      title: "Execute",
      detail: proposal.executable ? "Ready: anyone can execute the recovery now." : "Not yet available.",
      status: proposal.executable ? "current" : "upcoming",
    },
  ];
}

export interface RecoveryPermissions {
  isGuardian: boolean;
  isAdmin: boolean;
  hasApproved: boolean;
  canInitiate: boolean;
  canApprove: boolean;
  canRevoke: boolean;
  canExecute: boolean;
  canCancel: boolean;
  /** Why the admin can't cancel, when they can't. */
  cancelBlockedReason?: string;
}

/** What `account` may do right now, given the recovery state and the contract admin. */
export function recoveryPermissions(
  account: string,
  state: RecoveryState,
  admin: string | null | undefined,
): RecoveryPermissions {
  const proposal = state.proposal;
  const isGuardian = state.guardians.includes(account);
  const isAdmin = Boolean(admin) && admin === account;
  const hasApproved = Boolean(proposal?.approvals.includes(account));

  let canCancel = false;
  let cancelBlockedReason: string | undefined;
  if (proposal && isAdmin) {
    const supermajority = state.guardianCount > 0 && proposal.approvalsCount * 3 >= state.guardianCount * 2;
    if (supermajority) {
      cancelBlockedReason = "At least two thirds of the guardians approved, so the admin can no longer cancel.";
    } else if (!proposal.quorumReached || proposal.readyAtLedger === null) {
      canCancel = true;
    } else if (state.config && proposal.latestLedger !== null) {
      const windowClosesAt = proposal.readyAtLedger - Math.floor(state.config.delayInLedgers / 2);
      canCancel = proposal.latestLedger < windowClosesAt;
      if (!canCancel) cancelBlockedReason = "The cancel window (first half of the timelock) has closed.";
    } else {
      cancelBlockedReason = "The cancel window can't be determined right now.";
    }
  }

  return {
    isGuardian,
    isAdmin,
    hasApproved,
    canInitiate: isGuardian && state.configured && !proposal,
    canApprove: isGuardian && Boolean(proposal) && !hasApproved,
    canRevoke: isGuardian && hasApproved,
    canExecute: Boolean(proposal?.executable),
    canCancel,
    cancelBlockedReason,
  };
}
