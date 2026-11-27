import { describe, expect, it } from "vitest";
import type { RecoveryProposal, RecoveryState } from "@/lib/api/endpoints/contract";
import { recoveryPermissions, recoveryTimeline } from "./recovery";

const ADMIN = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const G1 = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const G2 = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";
const G3 = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3";
const NEW_ADMIN = "GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR";
const NOW = Date.parse("2026-11-26T12:00:00.000Z");

const base: RecoveryState = {
  guardians: [G1, G2, G3],
  guardianCount: 3,
  config: { threshold: 2, delayInLedgers: 720 },
  configured: true,
  proposal: null,
};

function withProposal(overrides: Partial<RecoveryProposal>): RecoveryState {
  return {
    ...base,
    proposal: {
      newAdmin: NEW_ADMIN,
      approvals: [G1],
      approvalsCount: 1,
      threshold: 2,
      approvalsRemaining: 1,
      quorumReached: false,
      readyAtLedger: null,
      latestLedger: 1000,
      ledgersRemaining: null,
      executableAt: null,
      executable: false,
      ...overrides,
    },
  };
}

const statuses = (state: RecoveryState) => recoveryTimeline(state, NOW).map((step) => step.status);

describe("recoveryTimeline", () => {
  it("shows the full path when nothing is pending", () => {
    const steps = recoveryTimeline(base, NOW);
    expect(steps.map((s) => s.status)).toEqual(["current", "upcoming", "upcoming", "upcoming"]);
    expect(steps[1]!.detail).toBe("2 guardian approvals are needed.");
    expect(steps[2]!.detail).toBe("Waits about 1h 00m once approved.");
  });

  it("is collecting approvals before quorum", () => {
    const steps = recoveryTimeline(withProposal({}), NOW);
    expect(steps.map((s) => s.status)).toEqual(["done", "current", "upcoming", "upcoming"]);
    expect(steps[1]!.detail).toBe("1 of 2 approvals (1 to go).");
  });

  it("counts down the timelock after quorum", () => {
    const state = withProposal({
      approvals: [G1, G2],
      approvalsCount: 2,
      approvalsRemaining: 0,
      quorumReached: true,
      readyAtLedger: 1500,
      ledgersRemaining: 500,
      executableAt: new Date(NOW + 2500_000).toISOString(),
    });
    expect(statuses(state)).toEqual(["done", "done", "current", "upcoming"]);
    expect(recoveryTimeline(state, NOW)[2]!.detail).toBe("Unlocks in 41m 40s.");
  });

  it("falls back to ledgers when there is no ETA", () => {
    const state = withProposal({ quorumReached: true, readyAtLedger: 1500, ledgersRemaining: 500 });
    expect(recoveryTimeline(state, NOW)[2]!.detail).toBe("Unlocks in 500 ledgers.");
  });

  it("is executable once the timelock elapsed", () => {
    const state = withProposal({ quorumReached: true, readyAtLedger: 900, executable: true });
    expect(statuses(state)).toEqual(["done", "done", "done", "current"]);
  });
});

describe("recoveryPermissions", () => {
  it("lets a guardian initiate only when configured and idle", () => {
    expect(recoveryPermissions(G1, base, ADMIN).canInitiate).toBe(true);
    expect(recoveryPermissions(G1, { ...base, configured: false, config: null }, ADMIN).canInitiate).toBe(false);
    expect(recoveryPermissions(ADMIN, base, ADMIN).canInitiate).toBe(false);
  });

  it("tracks approve/revoke per guardian", () => {
    const state = withProposal({});
    expect(recoveryPermissions(G1, state, ADMIN)).toMatchObject({ hasApproved: true, canApprove: false, canRevoke: true });
    expect(recoveryPermissions(G2, state, ADMIN)).toMatchObject({ hasApproved: false, canApprove: true, canRevoke: false });
  });

  it("lets the admin cancel before quorum", () => {
    expect(recoveryPermissions(ADMIN, withProposal({}), ADMIN).canCancel).toBe(true);
    expect(recoveryPermissions(G1, withProposal({}), ADMIN).canCancel).toBe(false);
  });

  it("closes the cancel window halfway through the timelock", () => {
    const early = withProposal({ quorumReached: true, readyAtLedger: 1700, latestLedger: 1000 });
    expect(recoveryPermissions(ADMIN, early, ADMIN).canCancel).toBe(true); // closes at 1340
    const late = withProposal({ quorumReached: true, readyAtLedger: 1700, latestLedger: 1400 });
    const verdict = recoveryPermissions(ADMIN, late, ADMIN);
    expect(verdict.canCancel).toBe(false);
    expect(verdict.cancelBlockedReason).toMatch(/cancel window/);
  });

  it("blocks cancel once two thirds of guardians approved", () => {
    const state = withProposal({ approvals: [G1, G2], approvalsCount: 2, quorumReached: true, readyAtLedger: 1700 });
    const verdict = recoveryPermissions(ADMIN, state, ADMIN);
    expect(verdict.canCancel).toBe(false);
    expect(verdict.cancelBlockedReason).toMatch(/two thirds/);
  });

  it("lets anyone execute when ready", () => {
    expect(recoveryPermissions(NEW_ADMIN, withProposal({ executable: true }), ADMIN).canExecute).toBe(true);
  });
});
