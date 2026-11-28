"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { formatBps, MAX_SLIPPAGE_BPS, parseSlippagePercent, SLIPPAGE_PRESETS_BPS } from "@/lib/swap/quote";

export interface SlippageSelectorProps {
  /** Tolerance in basis points (50 = 0.5%). */
  value: number;
  onChange: (bps: number) => void;
}

/** Preset tolerances plus a custom percentage, capped at the backend's 5%. */
export function SlippageSelector({ value, onChange }: SlippageSelectorProps) {
  const isPreset = (SLIPPAGE_PRESETS_BPS as readonly number[]).includes(value);
  const [custom, setCustom] = useState(isPreset ? "" : String(value / 100));
  const [invalid, setInvalid] = useState(false);
  const labelId = useId();
  const errorId = useId();

  function onCustom(input: string) {
    setCustom(input);
    if (input.trim() === "") {
      setInvalid(false);
      return;
    }
    const bps = parseSlippagePercent(input);
    setInvalid(bps === null);
    if (bps !== null) onChange(bps);
  }

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend id={labelId} className="mb-1.5 text-sm font-medium text-fg">
        Slippage tolerance
      </legend>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-labelledby={labelId}>
        {SLIPPAGE_PRESETS_BPS.map((bps) => (
          <button
            key={bps}
            type="button"
            role="radio"
            aria-checked={value === bps}
            onClick={() => {
              setCustom("");
              setInvalid(false);
              onChange(bps);
            }}
            className={cn(
              "h-8 rounded-lg border px-3 text-sm font-medium transition-colors",
              value === bps
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-fg-muted hover:bg-surface-muted hover:text-fg",
            )}
          >
            {formatBps(bps)}
          </button>
        ))}
        <span className="flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-sm focus-within:ring-2 focus-within:ring-ring">
          <input
            inputMode="decimal"
            aria-label="Custom slippage percent"
            placeholder="Custom"
            value={custom}
            onChange={(event) => onCustom(event.target.value.replace(",", "."))}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            className="w-16 bg-transparent text-fg outline-none placeholder:text-fg-muted"
          />
          <span className="text-fg-muted">%</span>
        </span>
      </div>
      {invalid ? (
        <p id={errorId} className="text-xs text-danger">
          Enter a percentage between 0 and {formatBps(MAX_SLIPPAGE_BPS)}.
        </p>
      ) : (
        value >= 300 && <p className="text-xs text-warning">High tolerance: you may receive noticeably less than quoted.</p>
      )}
    </fieldset>
  );
}
