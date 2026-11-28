"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ExternalLinkIcon } from "@/components/icons";
import { PageHeader } from "@/components/layout/PageHeader";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { AmountDisplay } from "@/components/ui/AmountDisplay";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAccountReserves, useCurrentAccount } from "@/hooks/useAccount";
import { useAssetMetadata, useVerifiedAssetIds } from "@/hooks/useAssets";
import type { AssetMetadataStatus } from "@/lib/api/endpoints/assets";
import { describeError } from "@/lib/api/errors";
import { parseAssetId } from "@/lib/stellar/asset";
import { accountUrl, explorerUrl } from "@/lib/stellar/explorer";

/** Why stellar.toml fields may be missing, in user terms. */
export const METADATA_STATUS_TEXT: Record<AssetMetadataStatus, string | null> = {
  ok: null,
  no_home_domain: "The issuer hasn't set a home domain, so there is no stellar.toml to read.",
  invalid_home_domain: "The issuer's home domain isn't a valid public domain.",
  toml_unavailable: "The issuer's stellar.toml couldn't be fetched right now.",
  toml_invalid: "The issuer's stellar.toml couldn't be read.",
  currency_not_listed: "The issuer's stellar.toml doesn't list this asset.",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-medium text-fg sm:text-right">{children}</dd>
    </div>
  );
}

/** /assets/[code]/[issuer]: stellar.toml info, issuer and the account's balance. */
export function AssetDetailView({ code, issuer, actions }: { code: string; issuer: string; actions?: ReactNode }) {
  const account = useCurrentAccount();
  const asset = parseAssetId(`${code}:${issuer}`);
  const metadata = useAssetMetadata(asset?.code, asset?.issuer);
  const reserves = useAccountReserves(account);
  const verified = useVerifiedAssetIds().has(`${code}:${issuer}`);
  const line = reserves.data?.balances.find((b) => b.asset_code === code && b.asset_issuer === issuer);

  const header = (
    <PageHeader
      title={metadata.data?.name ?? code}
      description={
        <span className="inline-flex items-center gap-2">
          {code}
          {verified && <Badge tone="success">Verified</Badge>}
        </span>
      }
      actions={
        <Link href="/assets" className="text-sm font-medium text-primary hover:underline">
          Back to assets
        </Link>
      }
    />
  );

  if (!asset) {
    return (
      <>
        {header}
        <EmptyState title="Unknown asset" description="An asset is identified by a code of up to 12 letters or digits and an issuer G... address." />
      </>
    );
  }

  const meta = metadata.data;
  const statusText = meta ? METADATA_STATUS_TEXT[meta.status] : null;

  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Your balance" />
          <CardBody>
            {reserves.isPending ? (
              <Skeleton className="h-6 w-40" />
            ) : line ? (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-2xl font-semibold text-fg">
                  <AmountDisplay amount={line.balance} asset={code} />
                </p>
                {actions}
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-sm text-fg-muted">You don&apos;t hold this asset.</p>
                {actions}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="About" description="From the issuer's stellar.toml" />
          <CardBody className="pt-2">
            {metadata.isPending ? (
              <Skeleton aria-label="Loading asset details" className="h-32" />
            ) : metadata.isError ? (
              <p className="text-sm text-fg-muted">{describeError(metadata.error)}</p>
            ) : (
              <>
                {statusText && (
                  <p role="note" className="mb-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
                    {statusText}
                  </p>
                )}
                <div className="flex items-start gap-4">
                  {meta?.image && (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary issuer domains; next/image would need each whitelisted.
                    <img src={meta.image} alt="" className="h-12 w-12 shrink-0 rounded-full bg-surface-muted object-cover" />
                  )}
                  <dl className="flex-1 divide-y divide-border">
                    {meta?.desc && <Row label="Description">{meta.desc}</Row>}
                    {meta?.orgName && <Row label="Organization">{meta.orgName}</Row>}
                    <Row label="Home domain">
                      {meta?.homeDomain ? (
                        <a href={`https://${meta.homeDomain}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          {meta.homeDomain}
                        </a>
                      ) : (
                        <span className="text-fg-muted">Not set</span>
                      )}
                    </Row>
                    <Row label="Display decimals">{meta?.decimals ?? 7}</Row>
                    <Row label="Issuer">
                      <AddressDisplay address={issuer} href={accountUrl(issuer)} />
                    </Row>
                  </dl>
                </div>
              </>
            )}
            <a
              href={explorerUrl("asset", `${code}-${issuer}`)}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              View on explorer <ExternalLinkIcon className="h-4 w-4" />
            </a>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
