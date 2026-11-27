"use client";

import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useResolveAddress } from "@/hooks/useResolveAddress";
import { describeError } from "@/lib/api/errors";
import type { MemoType } from "@/lib/stellar/memo";
import { classifyRecipient, recipientError, type RecipientKind } from "@/lib/stellar/recipient";

/** A recipient the send flow can pay. */
export interface Recipient {
  kind: Exclude<RecipientKind, "empty" | "invalid" | "contract">;
  /** What goes in the payment's destination: a G... or M... address. */
  destination: string;
  /** The underlying G... account (precheck, trustline and SEP-29 checks). */
  accountId: string;
  /** Memo a federation server asks for. */
  memo?: { type: Exclude<MemoType, "none">; value: string };
  /** The federation address the user typed, for the review screen. */
  federationAddress?: string;
  muxedId?: string;
}

export interface RecipientState {
  recipient: Recipient | null;
  /** Shown under the input; null while typing or when valid. */
  error: string | null;
  resolving: boolean;
}

/** Validate and (for federation / muxed input) resolve a "send to" field. */
export function useRecipient(input: string): RecipientState {
  const value = input.trim();
  const debounced = useDebouncedValue(value, 350);
  const kind = classifyRecipient(value);
  const resolve = useResolveAddress(kind === "federation" ? debounced : kind === "muxed" ? value : "");

  if (kind === "empty") return { recipient: null, error: null, resolving: false };
  if (kind === "account") return { recipient: { kind, destination: value, accountId: value }, error: null, resolving: false };
  if (kind === "invalid" || kind === "contract") return { recipient: null, error: recipientError(value), resolving: false };

  // Federation and muxed: wait for the debounced value and the backend.
  if ((kind === "federation" && debounced !== value) || resolve.isPending) {
    return { recipient: null, error: null, resolving: true };
  }
  if (resolve.isError) {
    return {
      recipient: null,
      error: kind === "federation" ? `Couldn't resolve ${value}: ${describeError(resolve.error)}` : describeError(resolve.error),
      resolving: false,
    };
  }
  const resolved = resolve.data!;
  if (kind === "muxed") {
    return {
      recipient: { kind, destination: resolved.muxedAddress ?? value, accountId: resolved.accountId, muxedId: resolved.muxedId },
      error: null,
      resolving: false,
    };
  }
  return {
    recipient: {
      kind,
      destination: resolved.accountId,
      accountId: resolved.accountId,
      federationAddress: value,
      memo: resolved.memo ? { type: resolved.memoType ?? "text", value: resolved.memo } : undefined,
    },
    error: null,
    resolving: false,
  };
}
