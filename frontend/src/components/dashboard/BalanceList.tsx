import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { AmountDisplay } from "@/components/ui/AmountDisplay";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import type { ReservesResponse } from "@/lib/api/endpoints/account";
import { assetFromBalanceLine, assetId, compareAssets, isNative } from "@/lib/stellar/asset";
import { accountUrl } from "@/lib/stellar/explorer";

export interface BalanceListProps {
  balances: ReservesResponse["balances"];
}

/** Every asset the account holds, native first, with total and spendable amounts. */
export function BalanceList({ balances }: BalanceListProps) {
  const rows = balances
    .map((line) => ({ line, asset: assetFromBalanceLine(line) }))
    .filter((row): row is { line: typeof row.line; asset: NonNullable<typeof row.asset> } => row.asset !== null)
    .sort((a, b) => compareAssets(a.asset, b.asset));

  return (
    <Card>
      <CardHeader title="Assets" description={`${rows.length} ${rows.length === 1 ? "asset" : "assets"}`} />
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
