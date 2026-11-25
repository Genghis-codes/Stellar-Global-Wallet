/**
 * #289 — claimable balance ids as Horizon reports them: the hex-encoded
 * ClaimableBalanceID XDR, i.e. a 4-byte type discriminant (always
 * "00000000" for V0) followed by the 32-byte balance hash — 72 lowercase
 * hex characters.
 */
const CLAIMABLE_BALANCE_ID = /^00000000[0-9a-f]{64}$/;

export function isValidClaimableBalanceId(value: unknown): boolean {
  return typeof value === "string" && CLAIMABLE_BALANCE_ID.test(value);
}
