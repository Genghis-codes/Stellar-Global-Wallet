"use client";

import { Input } from "@/components/ui/Input";
import { formatAmount } from "@/lib/format";

export interface AmountInputProps {
  value: string;
  onChange: (value: string) => void;
  assetCode: string;
  /** Most the user can send (spendable minus fee for XLM). */
  max: string;
  /** XLM locked by the minimum balance, shown so "available" isn't a surprise. */
  reserve?: string;
  error?: string | null;
  label?: string;
}

/** Amount field with a Max button and the available balance under it. */
export function AmountInput({ value, onChange, assetCode, max, reserve, error, label = "Amount" }: AmountInputProps) {
  const hint =
    `Available: ${formatAmount(max)} ${assetCode}` +
    (reserve ? ` (${formatAmount(reserve)} XLM is held as the account reserve and network fee)` : "");

  return (
    <Input
      label={label}
      name="amount"
      inputMode="decimal"
      autoComplete="off"
      placeholder="0.00"
      value={value}
      // Accept a comma as decimal separator; keep only digits and one dot.
      onChange={(event) => onChange(event.target.value.replace(",", ".").replace(/[^\d.]/g, ""))}
      error={error ?? undefined}
      hint={hint}
      trailing={
        <span className="flex items-center gap-2">
          <span>{assetCode}</span>
          <button
            type="button"
            className="rounded-md bg-surface-muted px-2 py-0.5 text-xs font-medium text-fg hover:bg-border disabled:opacity-50"
            onClick={() => onChange(max)}
            disabled={max === "0"}
          >
            Max
          </button>
        </span>
      }
    />
  );
}
