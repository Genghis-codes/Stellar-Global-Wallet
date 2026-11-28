"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { AmountDisplay } from "@/components/ui/AmountDisplay";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { isUnfundedAccountError, useAccountReserves, useCurrentAccount } from "@/hooks/useAccount";
import { useHiddenAssets, useVerifiedAssetIds } from "@/hooks/useAssets";
import type { ReservesResponse } from "@/lib/api/endpoints/account";
import { describeError } from "@/lib/api/errors";
import { AddAssetModal } from "./AddAssetModal";
import { assetFromBalanceLine, assetId, compareAssets, isNative, type AssetRef } from "@/lib/stellar/asset";

type Line = ReservesResponse["balances"][number];

export function assetHref(asset: AssetRef): string | null {
  return asset.issuer ? `/assets/${encodeURIComponent(asset.code)}/${asset.issuer}` : null;
}

function AssetRow({
  line,
  asset,
  verified,
  hidden,
  onToggleHidden,
}: {
  line: Line;
  asset: AssetRef;
  verified: boolean;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const href = assetHref(asset);
  const name = (
    <span className="flex items-center gap-2 font-medium text-fg">
      {asset.code}
      {isNative(asset) && <Badge>Native</Badge>}
      {verified && <Badge tone="success">Verified</Badge>}
      {line.is_authorized === false && <Badge tone="warning">Not authorized</Badge>}
      {hidden && <Badge>Hidden</Badge>}
    </span>
  );
  return (
    <li className="flex flex-wrap items-center justify-between gap-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-fg">
          {asset.code.slice(0, 4)}
        </span>
        <div className="min-w-0">
          {href ? (
            <Link href={href} className="hover:underline">
              {name}
            </Link>
          ) : (
            name
          )}
          {asset.issuer ? (
            <AddressDisplay address={asset.issuer} copyable={false} className="text-sm text-fg-muted" />
          ) : (
            <p className="text-sm text-fg-muted">Stellar Lumens</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4">
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
        {!isNative(asset) && (
          <Button variant="ghost" size="sm" onClick={onToggleHidden} aria-label={`${hidden ? "Unhide" : "Hide"} ${asset.code}`}>
            {hidden ? "Unhide" : "Hide"}
          </Button>
        )}
      </div>
    </li>
  );
}

/** /assets: every balance with verified badges and hide/unhide. */
export function AssetsView() {
  const account = useCurrentAccount();
  const reserves = useAccountReserves(account);
  const verified = useVerifiedAssetIds();
  const { isHidden, toggle } = useHiddenAssets();
  const [showHidden, setShowHidden] = useState(false);
  const [adding, setAdding] = useState(false);

  const rows = useMemo(
    () =>
      (reserves.data?.balances ?? [])
        .map((line) => ({ line, asset: assetFromBalanceLine(line) }))
        .filter((row): row is { line: Line; asset: AssetRef } => row.asset !== null)
        .sort((a, b) => compareAssets(a.asset, b.asset)),
    [reserves.data],
  );
  const hiddenCount = rows.filter((row) => isHidden(assetId(row.asset))).length;
  const held = useMemo(() => new Set(rows.map((row) => assetId(row.asset))), [rows]);
  const visible = showHidden ? rows : rows.filter((row) => !isHidden(assetId(row.asset)));

  return (
    <>
      <PageHeader
        title="Assets"
        description="Balances and trustlines on your account."
        actions={
          reserves.isSuccess && (
            <Button size="sm" onClick={() => setAdding(true)}>
              Add asset
            </Button>
          )
        }
      />
      <AddAssetModal open={adding} onClose={() => setAdding(false)} account={account} held={held} />
      {reserves.isPending ? (
        <Skeleton aria-label="Loading assets" className="h-64 rounded-[var(--radius-card)]" />
      ) : reserves.isError ? (
        isUnfundedAccountError(reserves.error) ? (
          <EmptyState title="Account not funded" description="Fund your account with XLM before adding assets." />
        ) : (
          <EmptyState
            title="Couldn't load your assets"
            description={describeError(reserves.error)}
            action={<Button onClick={() => void reserves.refetch()}>Try again</Button>}
          />
        )
      ) : (
        <Card>
          <CardHeader
            title="Your assets"
            description={`${rows.length} ${rows.length === 1 ? "asset" : "assets"}${hiddenCount ? `, ${hiddenCount} hidden` : ""}`}
            action={
              hiddenCount > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setShowHidden((v) => !v)}>
                  {showHidden ? "Hide hidden assets" : "Show hidden assets"}
                </Button>
              )
            }
          />
          <ul aria-label="Assets" className="divide-y divide-border px-5 pb-2 pt-3">
            {visible.map(({ line, asset }) => {
              const id = assetId(asset);
              return (
                <AssetRow
                  key={id}
                  line={line}
                  asset={asset}
                  verified={verified.has(id)}
                  hidden={isHidden(id)}
                  onToggleHidden={() => toggle(id)}
                />
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
