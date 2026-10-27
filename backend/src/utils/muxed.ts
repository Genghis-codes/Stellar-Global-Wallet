/** Largest muxed account ID: muxed IDs are uint64 (SEP-0023). */
export const MAX_MUXED_ID = 18446744073709551615n;

/**
 * Whether `value` is a valid muxed sub-account ID: a non-negative integer
 * within uint64, given as a JSON number (safe integers only) or a decimal
 * string (needed above 2^53, which JSON numbers can't carry exactly).
 */
export function isValidMuxedId(value: unknown): boolean {
  let id: bigint;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return false;
    id = BigInt(value);
  } else if (typeof value === "string" && /^\d{1,20}$/.test(value)) {
    id = BigInt(value);
  } else {
    return false;
  }
  return id >= 0n && id <= MAX_MUXED_ID;
}
