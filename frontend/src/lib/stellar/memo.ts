/**
 * Transaction memos. Stellar supports text (at most 28 UTF-8 bytes), id
 * (uint64) and hash (32 bytes, hex). The backend's build routes attach
 * MEMO_TEXT only; id and hash memos still matter for validating payment
 * requests and federation records.
 */

export type MemoType = "none" | "text" | "id" | "hash";

export const MAX_MEMO_TEXT_BYTES = 28;
const MAX_UINT64 = 18_446_744_073_709_551_615n;

/** UTF-8 byte length (emoji and accented letters count for more than one byte). */
export function memoTextByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** An error message for `value` as a memo of `type`, or null when it is valid (or empty). */
export function validateMemo(type: MemoType, value: string): string | null {
  if (type === "none" || value === "") return null;
  if (type === "text") {
    const bytes = memoTextByteLength(value);
    return bytes > MAX_MEMO_TEXT_BYTES
      ? `Memo is ${bytes} bytes; the limit is ${MAX_MEMO_TEXT_BYTES} bytes (emoji and accented letters use more than one).`
      : null;
  }
  if (type === "id") {
    if (!/^\d+$/.test(value)) return "Memo ID must be a whole number.";
    return BigInt(value) > MAX_UINT64 ? "Memo ID is too large (max 18446744073709551615)." : null;
  }
  return /^[0-9a-f]{64}$/i.test(value) ? null : "Memo hash must be 64 hexadecimal characters (32 bytes).";
}

/** SEP-7 / payment-request memo_type to a MemoType ("MEMO_RETURN" is a hash). */
export function memoTypeFromSep7(memoType: string | undefined): MemoType {
  switch (memoType?.toUpperCase()) {
    case "MEMO_ID":
      return "id";
    case "MEMO_HASH":
    case "MEMO_RETURN":
      return "hash";
    default:
      return "text";
  }
}

/** MemoType to the SEP-7 memo_type the payment-request route accepts. */
export function memoTypeToSep7(type: Exclude<MemoType, "none">): "MEMO_TEXT" | "MEMO_ID" | "MEMO_HASH" {
  return type === "id" ? "MEMO_ID" : type === "hash" ? "MEMO_HASH" : "MEMO_TEXT";
}
