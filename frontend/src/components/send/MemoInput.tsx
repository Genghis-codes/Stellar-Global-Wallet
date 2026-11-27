"use client";

import { Input } from "@/components/ui/Input";
import { MAX_MEMO_TEXT_BYTES, memoTextByteLength } from "@/lib/stellar/memo";

export interface MemoInputProps {
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  /** The destination requires a memo (SEP-29) or a federation record set one. */
  required?: boolean;
  /** A federation server fixed the memo; the user can't change it. */
  locked?: boolean;
}

/**
 * Text memo with a live byte counter. The backend's build routes attach
 * MEMO_TEXT only, so id/hash memos are not offered here.
 */
export function MemoInput({ value, onChange, error, required, locked }: MemoInputProps) {
  const bytes = memoTextByteLength(value);
  return (
    <Input
      label={required ? "Memo (required)" : "Memo (optional)"}
      name="memo"
      autoComplete="off"
      placeholder={required ? "e.g. your exchange deposit ID" : "What's this for?"}
      value={value}
      readOnly={locked}
      onChange={(event) => onChange(event.target.value)}
      error={error ?? undefined}
      hint={
        locked
          ? "Set by the recipient's federation server."
          : required
            ? "The recipient needs a memo to credit this payment. Sending without one may lose funds."
            : "Exchanges often need a memo to credit your deposit."
      }
      trailing={
        <span className={bytes > MAX_MEMO_TEXT_BYTES ? "text-danger" : undefined} aria-label={`${bytes} of ${MAX_MEMO_TEXT_BYTES} bytes`}>
          {bytes}/{MAX_MEMO_TEXT_BYTES}
        </span>
      }
    />
  );
}
