import { describe, expect, it } from "vitest";
import type { RecoveryState } from "@/lib/api/endpoints/contract";
import { MAX_GUARDIANS, checkAddGuardian, checkRemoveGuardian } from "./guardians";

const G1 = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const G2 = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";
const NEW = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

const unconfigured: RecoveryState = { guardians: [G1, G2], guardianCount: 2, config: null, configured: false, proposal: null };
const configured: RecoveryState = { ...unconfigured, config: { threshold: 2, delayInLedgers: 100 }, configured: true };

describe("checkAddGuardian", () => {
  it("adds immediately before recovery is configured and queues after", () => {
    expect(checkAddGuardian(unconfigured, NEW)).toEqual({ ok: true, queued: false });
    expect(checkAddGuardian(configured, NEW)).toEqual({ ok: true, queued: true });
  });

  it("refuses duplicates, a full set and a frozen set", () => {
    expect(checkAddGuardian(unconfigured, G1).ok).toBe(false);
    const full = { ...unconfigured, guardianCount: MAX_GUARDIANS };
    expect(checkAddGuardian(full, NEW)).toMatchObject({ ok: false, reason: expect.stringContaining("15") });
    const frozen = { ...configured, proposal: {} as RecoveryState["proposal"] };
    expect(checkAddGuardian(frozen, NEW)).toMatchObject({ ok: false, reason: expect.stringContaining("recovery") });
  });
});

describe("checkRemoveGuardian", () => {
  it("keeps at least the threshold of guardians", () => {
    expect(checkRemoveGuardian(configured, G1)).toMatchObject({ ok: false, reason: expect.stringContaining("at least 2") });
    expect(checkRemoveGuardian(unconfigured, G1)).toEqual({ ok: true, queued: false });
    const three = { ...configured, guardians: [G1, G2, NEW], guardianCount: 3 };
    expect(checkRemoveGuardian(three, G1)).toEqual({ ok: true, queued: true });
  });

  it("refuses unknown guardians", () => {
    expect(checkRemoveGuardian(unconfigured, NEW).ok).toBe(false);
  });
});
