"use client";

import { useState } from "react";
import { AmountInput } from "@/components/send/AmountInput";
import { AssetPicker, type AssetOption } from "@/components/send/AssetPicker";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { useSwapQuote, canQuote } from "@/hooks/useSwapQuote";
import type { PaymentPath } from "@/lib/api/endpoints/wallet";
import { describeError } from "@/lib/api/errors";
import { cn } from "@/lib/cn";
import { formatAmount } from "@/lib/format";
import { compareAmounts, isValidAmount } from "@/lib/stellar/amount";
import { DEFAULT_SLIPPAGE_BPS, maxSent, type SwapMode } from "@/lib/swap/quote";
import { QuoteSummary } from "./QuoteSummary";
import { SlippageSelector } from "./SlippageSelector";

/** Everything the review step needs: the inputs plus the quote they were priced at. */
export interface SwapDraft {
  mode: SwapMode;
  from: AssetOption;
  to: AssetOption;
  /** The exact side's amount (pay in "send" mode, receive in "receive" mode). */
  amount: string;
  slippageBps: number;
  quote: PaymentPath;
}

export interface SwapFormProps {
  /** The account's assets (at least two). */
  options: AssetOption[];
  onReview: (draft: SwapDraft) => void;
}

const MODES: Array<{ id: SwapMode; label: string }> = [
  { id: "send", label: "Exact amount to pay" },
  { id: "receive", label: "Exact amount to receive" },
];

/**
 * Pick two of the account's assets, an exact amount on one side and a
 * slippage tolerance; the best route is quoted live from Horizon via the
 * backend. Only assets the account already holds can be received, because
 * a path payment can't create a trustline.
 */
export function SwapForm({ options, onReview }: SwapFormProps) {
  const [mode, setMode] = useState<SwapMode>("send");
  const [fromId, setFromId] = useState(options[0]?.id ?? "");
  const [toId, setToId] = useState(options.find((option) => option.id !== options[0]?.id)?.id ?? "");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);

  const from = options.find((option) => option.id === fromId);
  const to = options.find((option) => option.id === toId);
  const input = { mode, amount: amount.trim(), from: fromId, to: toId };
  const { query: quote, settled } = useSwapQuote(input);
  // Only trust a quote fetched for exactly what is on screen (not a stale debounce).
  const current = settled && quote.isSuccess;
  const best = current ? (quote.data ?? null) : null;
  const quoteMatches = best !== null;

  let amountError: string | null = null;
  if (input.amount && !isValidAmount(input.amount)) {
    amountError = "Enter an amount with at most 7 decimals.";
  } else if (from && mode === "send" && input.amount && compareAmounts(input.amount, from.spendable) > 0) {
    amountError = `You can swap at most ${formatAmount(from.spendable)} ${from.asset.code}.`;
  }
  const exceedsSpendable =
    mode === "receive" && from && best && compareAmounts(maxSent(best.source_amount, slippageBps), from.spendable) > 0;

  function pickFrom(id: string) {
    if (id === toId) setToId(fromId);
    setFromId(id);
  }

  function pickTo(id: string) {
    if (id === fromId) setFromId(toId);
    setToId(id);
  }

  function flip() {
    setFromId(toId);
    setToId(fromId);
    setAmount("");
  }

  const canReview = Boolean(from && to && quoteMatches && !amountError && !exceedsSpendable);

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (canReview && from && to && best) onReview({ mode, from, to, amount: input.amount, slippageBps, quote: best });
      }}
    >
      <div role="radiogroup" aria-label="Swap mode" className="grid grid-cols-2 gap-1 rounded-lg bg-surface-muted p-1">
        {MODES.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={mode === option.id}
            onClick={() => {
              setMode(option.id);
              setAmount("");
            }}
            className={cn(
              "h-9 rounded-md text-sm font-medium transition-colors",
              mode === option.id ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <AssetPicker label="You pay" options={options} value={fromId} onChange={pickFrom} />
        {mode === "send" && from && (
          <AmountInput
            label="Amount to pay"
            value={amount}
            onChange={setAmount}
            assetCode={from.asset.code}
            max={from.spendable}
            error={amountError}
          />
        )}
      </div>

      <div className="flex justify-center">
        <Button variant="secondary" size="sm" onClick={flip} aria-label="Switch assets">
          ⇅
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <AssetPicker label="You receive" options={options} value={toId} onChange={pickTo} />
        {mode === "receive" && to && (
          <Input
            label="Amount to receive"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(",", ".").replace(/[^\d.]/g, ""))}
            error={amountError ?? undefined}
            trailing={to.asset.code}
          />
        )}
      </div>

      <div aria-live="polite" className="min-h-6 text-sm">
        {!canQuote(input) ? null : quote.isError && settled ? (
          <p className="text-danger">{describeError(quote.error)}</p>
        ) : !current ? (
          <p className="flex items-center gap-2 text-fg-muted">
            <Spinner size="sm" label={null} /> Finding the best route…
          </p>
        ) : best === null ? (
          <p className="text-warning">
            No route found from {from?.asset.code} to {to?.asset.code} for this amount. Try a smaller amount.
          </p>
        ) : (
          <p className="text-fg">
            {mode === "send" ? "You receive about " : "You pay about "}
            <strong>
              {formatAmount(mode === "send" ? best.destination_amount : best.source_amount)}{" "}
              {mode === "send" ? to?.asset.code : from?.asset.code}
            </strong>
          </p>
        )}
        {exceedsSpendable && from && best && (
          <p className="mt-1 text-danger">
            This could cost up to {formatAmount(maxSent(best.source_amount, slippageBps))} {from.asset.code}, more than
            your {formatAmount(from.spendable)} available.
          </p>
        )}
      </div>

      {best && quoteMatches && from && to && (
        <QuoteSummary quote={best} mode={mode} slippageBps={slippageBps} fromCode={from.asset.code} toCode={to.asset.code} />
      )}

      <SlippageSelector value={slippageBps} onChange={setSlippageBps} />

      <Button type="submit" size="lg" fullWidth disabled={!canReview}>
        Review swap
      </Button>
    </form>
  );
}
