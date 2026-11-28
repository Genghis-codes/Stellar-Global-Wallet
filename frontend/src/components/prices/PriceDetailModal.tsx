"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAssetPrices, usePriceHistory } from "@/hooks/usePrices";
import type { PriceHistoryRange, PriceSource } from "@/lib/api/endpoints/price";
import { describeError } from "@/lib/api/errors";
import { formatFiat } from "@/lib/format";
import { multiplyDecimal, quoteState } from "@/lib/price/valuation";
import { parseAssetId } from "@/lib/stellar/asset";
import { cn } from "@/lib/cn";
import { PriceChart } from "./PriceChart";
import { formatPercent, percentChange, toChartPoints } from "./priceChange";

const RANGES: { value: PriceHistoryRange; label: string; long: string }[] = [
  { value: "24h", label: "24H", long: "last 24 hours" },
  { value: "7d", label: "7D", long: "last 7 days" },
  { value: "30d", label: "30D", long: "last 30 days" },
  { value: "1y", label: "1Y", long: "last year" },
];

const SOURCE_LABEL: Record<PriceSource, string> = {
  stellar_dex: "Stellar DEX",
  coingecko: "CoinGecko",
  consensus: "Multiple sources",
  unavailable: "Unavailable",
};

export interface PriceDetailModalProps {
  /** Asset id: "XLM" or "CODE:ISSUER". */
  asset: string;
  /** Amount held, to show its value. */
  amount?: string;
  currency?: string;
  onClose: () => void;
}

/** Current price, value of the holding and price history for one asset. */
export function PriceDetailModal({ asset, amount, currency = "USD", onClose }: PriceDetailModalProps) {
  const [range, setRange] = useState<PriceHistoryRange>("7d");
  const prices = useAssetPrices([asset]);
  const history = usePriceHistory(asset, range);
  const code = parseAssetId(asset)?.code ?? asset;
  const quote = prices.data?.find((q) => q.asset === asset);
  const state = quoteState(quote);
  const points = useMemo(() => toChartPoints(history.data?.points ?? []), [history.data]);
  const change = percentChange(points);
  const rangeLabel = RANGES.find((r) => r.value === range)!.long;

  return (
    <Modal open onClose={onClose} title={`${code} price`} size="lg">
      <div className="flex flex-col gap-4">
        {prices.isPending ? (
          <Skeleton className="h-16 w-56" aria-label="Loading price" />
        ) : prices.isError ? (
          <p className="text-sm text-danger">{describeError(prices.error)}</p>
        ) : state === "missing" ? (
          <p className="text-sm text-fg-muted">No price is available for {code} right now.</p>
        ) : (
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-3xl font-semibold tracking-tight text-fg">
                {formatFiat(quote!.price!, currency)}
                {state === "stale" && <Badge tone="warning">May be out of date</Badge>}
              </p>
              <p className="mt-1 text-xs text-fg-muted">
                {SOURCE_LABEL[quote!.source]}
                {quote!.updatedAt && ` · Updated ${new Date(quote!.updatedAt).toLocaleString()}`}
              </p>
            </div>
            {amount && (
              <div className="text-right">
                <p className="text-sm text-fg-muted">Your {code}</p>
                <p className="text-lg font-medium text-fg">
                  {formatFiat(multiplyDecimal(amount, quote!.price!) ?? "0", currency)}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div role="group" aria-label="Chart range" className="inline-flex rounded-lg border border-border p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={range === r.value}
                aria-label={r.long}
                onClick={() => setRange(r.value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium",
                  range === r.value ? "bg-primary text-primary-fg" : "text-fg-muted hover:text-fg"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
          {change !== null && (
            <span className={cn("text-sm font-medium", change >= 0 ? "text-success" : "text-danger")}>
              {formatPercent(change)} <span className="sr-only">over the {rangeLabel}</span>
            </span>
          )}
        </div>

        {history.isPending ? (
          <Skeleton className="h-40" aria-label="Loading price history" />
        ) : history.isError ? (
          <p className="py-10 text-center text-sm text-danger">{describeError(history.error)}</p>
        ) : history.data.source === "unavailable" ? (
          <p className="py-10 text-center text-sm text-fg-muted">Price history isn&apos;t available for {code}.</p>
        ) : (
          <PriceChart points={points} currency={currency} label={`${code} price, ${rangeLabel}`} />
        )}
      </div>
    </Modal>
  );
}
