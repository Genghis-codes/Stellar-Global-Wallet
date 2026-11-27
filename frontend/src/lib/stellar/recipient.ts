import { isAccountId, isContractId, isFederationAddress, isMuxedAddress } from "./address";

/** What a "send to" input contains. */
export type RecipientKind = "empty" | "account" | "muxed" | "federation" | "contract" | "invalid";

export function classifyRecipient(input: string): RecipientKind {
  const value = input.trim();
  if (value === "") return "empty";
  if (isAccountId(value)) return "account";
  if (isMuxedAddress(value)) return "muxed";
  if (isFederationAddress(value)) return "federation";
  if (isContractId(value)) return "contract";
  return "invalid";
}

/**
 * A user-facing error for a recipient the send flow cannot pay, or null.
 * Federation addresses are syntactically checked here and resolved by the
 * backend (/api/v1/resolve).
 */
export function recipientError(input: string): string | null {
  switch (classifyRecipient(input)) {
    case "empty":
      return "Enter a recipient.";
    case "contract":
      return "Contract (C...) addresses can't receive classic payments.";
    case "invalid": {
      const value = input.trim();
      if (/^[GM]/.test(value) && /^[A-Z2-7]+$/.test(value)) return "This address is incomplete or has a typo (checksum failed).";
      return "Enter a Stellar address (G... or M...) or a federation address (name*domain.com).";
    }
    default:
      return null;
  }
}
