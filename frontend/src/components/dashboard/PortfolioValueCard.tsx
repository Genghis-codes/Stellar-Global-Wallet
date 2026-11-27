"use client";

import { Card, CardBody } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import type { PortfolioValue } from "@/hooks/usePrices";
import { formatFiat } from "@/lib/format";
import { parseAssetId } from "@/lib/stellar/asset";

function codes(ids: string[]): string {
  return ids.map((id) => parseAssetId(id)?.code ?? id).join(", ");
}

/** Total portfolio value in the display currency, with notes about stale or missing prices. */
export function PortfolioValueCard({ portfolio }: { portfolio: PortfolioValue }) {
  if (!portfolio.enabled) return null;
  const { valuation, currency } = portfolio;

  return (
    <Card>
      <CardBody>
        <p className="text-sm text-fg-muted">Total portfolio value</p>
        {portfolio.isPending ? (
          <Skeleton className="mt-2 h-9 w-48" aria-label="Loading portfolio value" />
        ) : !valuation ? (
          <p className="mt-1 text-sm text-fg-muted">Prices are unavailable right now.</p>
        ) : (
          <>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-fg" aria-live="polite">
              {formatFiat(valuation.total, currency)}
            </p>
            <ul className="mt-2 flex flex-col gap-1 text-xs text-fg-muted">
              {valuation.missing.length > 0 && (
                <li>No price for {codes(valuation.missing)}; not included in the total.</li>
              )}
              {valuation.stale.length > 0 && (
                <li className="text-warning">Prices for {codes(valuation.stale)} may be out of date.</li>
              )}
              {portfolio.currencyFallback && (
                <li>Shown in {currency}: conversion to your display currency isn&apos;t available yet.</li>
              )}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}
