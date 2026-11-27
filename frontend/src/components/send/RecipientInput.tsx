"use client";

import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import type { RecipientState } from "./useRecipient";

export interface RecipientInputProps {
  value: string;
  onChange: (value: string) => void;
  state: RecipientState;
  /** Show the validation error (after the field was touched). */
  showError?: boolean;
  /** The signed-in account, to flag sending to yourself. */
  self?: string;
}

/** "Send to" field: G..., M... or name*domain, with live resolution feedback. */
export function RecipientInput({ value, onChange, state, showError = true, self }: RecipientInputProps) {
  const { recipient, error, resolving } = state;
  let hint = "A Stellar address (G... or M...) or a federation address like name*domain.com.";
  if (recipient?.kind === "federation") hint = "";
  if (recipient?.kind === "muxed") hint = recipient.muxedId ? `Muxed address for sub-account ${recipient.muxedId}.` : "Muxed address.";
  if (recipient && recipient.accountId === self) hint = "This is your own account.";

  return (
    <div className="flex flex-col gap-1.5">
      <Input
        label="Recipient"
        name="recipient"
        autoComplete="off"
        spellCheck={false}
        placeholder="G... / M... / name*domain.com"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        error={showError ? (error ?? undefined) : undefined}
        hint={hint || undefined}
        trailing={resolving ? <Spinner size="sm" label="Resolving address" /> : undefined}
        className="font-mono"
      />
      {recipient?.kind === "federation" && (
        <p className="flex flex-wrap items-center gap-1 text-xs text-fg-muted" aria-live="polite">
          Resolves to <AddressDisplay address={recipient.accountId} chars={6} />
          {recipient.memo && <span>with memo {recipient.memo.value}</span>}
        </p>
      )}
    </div>
  );
}
