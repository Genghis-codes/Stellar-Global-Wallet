import type { RecoveryState } from "@/lib/api/endpoints/contract";

/**
 * Guardian-set rules of the globe-wallet contract (`add_guardian`,
 * `remove_guardian`, issues #27 and #175), checked before building:
 * - at most 15 guardians;
 * - the set is frozen while a recovery proposal is pending;
 * - removing must leave at least `threshold` guardians;
 * - once recovery is configured, changes are queued for the recovery delay.
 */

export const MAX_GUARDIANS = 15;

export type GuardianCheck = { ok: true; queued: boolean } | { ok: false; reason: string };

export function checkAddGuardian(state: RecoveryState, guardian: string): GuardianCheck {
  if (state.proposal) return { ok: false, reason: "Guardians can't change while a recovery is in progress." };
  if (state.guardians.includes(guardian)) return { ok: false, reason: "That account is already a guardian." };
  if (state.guardianCount >= MAX_GUARDIANS) return { ok: false, reason: `A wallet can have at most ${MAX_GUARDIANS} guardians.` };
  return { ok: true, queued: state.configured };
}

export function checkRemoveGuardian(state: RecoveryState, guardian: string): GuardianCheck {
  if (state.proposal) return { ok: false, reason: "Guardians can't change while a recovery is in progress." };
  if (!state.guardians.includes(guardian)) return { ok: false, reason: "That account isn't a guardian." };
  const threshold = state.config?.threshold ?? 0;
  if (state.guardianCount - 1 < threshold) {
    return {
      ok: false,
      reason: `Recovery needs ${threshold} guardian approvals, so at least ${threshold} guardians must remain.`,
    };
  }
  return { ok: true, queued: state.configured };
}
