/**
 * Session-store facade used by account-level flows (e.g. #38 recovery
 * execution) that need to end every session for an account without
 * knowing about refresh-token internals.
 */
import { revokeAllSessions as revokeAll } from "../utils/jwt";

/** Revokes every refresh-token session for `sub`. Safe to call repeatedly. */
export async function revokeAllSessions(sub: string): Promise<number> {
  return revokeAll(sub);
}
