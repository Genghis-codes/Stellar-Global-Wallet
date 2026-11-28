"use client";

import type { NetworkFeesResponse } from "@/lib/api/endpoints/config";
import { cn } from "@/lib/cn";
import { formatAmount } from "@/lib/format";
import { fromStroops } from "@/lib/stellar/amount";

export type FeeTier = "low" | "normal" | "high";

const TIERS: Array<{ id: FeeTier; label: string; description: string }> = [
  { id: "low", label: "Low", description: "Fine when the network is quiet" },
  { id: "normal", label: "Normal", description: "Recommended" },
  { id: "high", label: "Fast", description: "For busy periods" },
];

export interface FeePickerProps {
  fees: NetworkFeesResponse | undefined;
  value: FeeTier;
  onChange: (tier: FeeTier) => void;
  /** Operations in the transaction (the fee is charged per operation). */
  operations?: number;
}

/** Per-operation fee tiers from GET /network/fees, as a radio group. */
export function FeePicker({ fees, value, onChange, operations = 1 }: FeePickerProps) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-fg">Network fee</legend>
      <div className="grid grid-cols-3 gap-2">
        {TIERS.map((tier) => {
          const estimate = fees?.[tier.id];
          const selected = value === tier.id;
          return (
            <label
              key={tier.id}
              className={cn(
                "flex cursor-pointer flex-col rounded-lg border p-2.5 text-left focus-within:ring-2 focus-within:ring-ring",
                selected ? "border-primary bg-surface-muted" : "border-border bg-surface hover:bg-surface-muted",
              )}
            >
              <input
                type="radio"
                name="fee-tier"
                value={tier.id}
                checked={selected}
                onChange={() => onChange(tier.id)}
                className="sr-only"
              />
              <span className="text-sm font-medium text-fg">{tier.label}</span>
              <span className="text-xs text-fg-muted">
                {estimate ? `${formatAmount(fromStroops(BigInt(estimate.stroops) * BigInt(operations)))} XLM` : "…"}
              </span>
              <span className="mt-0.5 hidden text-xs text-fg-muted sm:block">{tier.description}</span>
            </label>
          );
        })}
      </div>
      {fees?.source === "fallback" && (
        <p className="text-xs text-warning">Live fee data is unavailable; showing the network minimum.</p>
      )}
    </fieldset>
  );
}
