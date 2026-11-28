import Link from "next/link";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { AmountDisplay } from "@/components/ui/AmountDisplay";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import type { ReservesResponse } from "@/lib/api/endpoints/account";
import { formatFiat } from "@/lib/format";
import type { Valuation } from "@/lib/price/valuation";
import { assetFromBalanceLine, assetId, compareAssets, isNative } from "@/lib/stellar/asset";
import { accountUrl } from "@/lib/stellar/explorer";

export interface BalanceListProps {
  balances: ReservesResponse["balances"];
  /** Fiat values by asset id; omit to hide fiat values (no price source). */
  valuations?: Map<string, Valuation>;
  currency?: string;
  /** Open the price detail for an asset (shown as a "Price" button when set). */
  onShowPrice?: (assetId: string, amount: string) => void;
  /** Asset ids the user hid (preferences.hiddenAssets); XLM is always shown. */
  hidden?: string[];
}

/** Every asset the account holds, native first, with total and spendable amounts. */
export function BalanceList({ balances, valuations, currency = "USD", onShowPrice, hidden = [] }: BalanceListProps) {
  const all = balances
    .map((line) => ({ line, asset: assetFromBalanceLine(line) }))
    .filter((row): row is { line: typeof row.line; asset: NonNullable<typeof row.asset> } => row.asset !== null)
    .sort((a, b) => compareAssets(a.asset, b.asset));
  const rows = all.filter((row) => isNative(row.asset) || !hidden.includes(assetId(row.asset)));
  const hiddenCount = all.length - rows.length;

  return (
    <Card>
      <CardHeader
        title="Assets"
        description={`${rows.length} ${rows.length === 1 ? "asset" : "assets"}${hiddenCount ? `, ${hiddenCount} hidden` : ""}`}
        action={
          <Link href="/assets" className="text-sm font-medium text-primary hover:underline">
            Manage
          </Link>
        }
      />
      <ul className="divide-y divide-border px-5 pb-2 pt-3">
        {rows.map(({ line, asset }) => (
          <li key={assetId(asset)} className="flex items-center justify-between gap-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-fg">
                {asset.code.slice(0, 4)}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium text-fg">
                  {asset.code}
                  {isNative(asset) && <Badge>Native</Badge>}
                  {line.is_authorized === false && <Badge tone="warning">Not authorized</Badge>}
                </p>
                {asset.issuer ? (
                  <AddressDisplay
                    address={asset.issuer}
                    href={accountUrl(asset.issuer)}
                    copyable={false}
                    className="text-fg-muted"
                  />
                ) : (
                  <p className="text-sm text-fg-muted">Stellar Lumens</p>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="font-medium text-fg">
                <AmountDisplay amount={line.balance} asset={asset.code} />
              </p>
              {valuations && <FiatValue valuation={valuations.get(assetId(asset))} currency={currency} />}
              {onShowPrice && (
                <button
                  type="button"
                  onClick={() => onShowPrice(assetId(asset), line.balance)}
                  aria-label={`View ${asset.code} price`}
                  className="mt-0.5 rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Price
                </button>
              )}
              {line.spendable !== line.balance && (
                <p className="text-xs text-fg-muted">
                  <AmountDisplay amount={line.spendable} /> spendable
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function FiatValue({ valuation, currency }: { valuation: Valuation | undefined; currency: string }) {
  if (!valuation || valuation.value === null) {
    return <p className="text-xs text-fg-muted">No price</p>;
  }
  return (
    <p className="text-xs text-fg-muted">
      {formatFiat(valuation.value, currency)}
      {valuation.state === "stale" && (
        <span className="ml-1 text-warning" title="This price may be out of date">
          (stale)
        </span>
      )}
    </p>
  );
}
