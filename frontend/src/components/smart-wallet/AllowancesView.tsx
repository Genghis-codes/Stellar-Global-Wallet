"use client";

import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { describeError } from "@/lib/api/errors";
import { useCurrentAccount } from "@/hooks/useAccount";
import { useContractAssets, useSpendAllowances } from "@/hooks/useSmartWallet";
import { AllowanceMeter } from "./AllowanceMeter";
import { GrantAssetModal } from "./GrantAssetModal";
import { RevokeAssetModal } from "./RevokeAssetModal";

export function AllowancesView() {
  const account = useCurrentAccount();
  const assets = useContractAssets(account);
  const allowances = useSpendAllowances(account);
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Allowances"
        description="Assets the smart wallet may send, with what's left of each 24-hour limit."
        actions={<Button onClick={() => setGranting(true)}>Allow asset</Button>}
      />
      {assets.isPending ? (
        <Skeleton className="h-40 rounded-[var(--radius-card)]" />
      ) : assets.isError ? (
        <EmptyState
          title="Couldn't load allowances"
          description={describeError(assets.error)}
          action={<Button onClick={() => void assets.refetch()}>Try again</Button>}
        />
      ) : assets.data.length === 0 ? (
        <EmptyState
          title="No assets allowed yet"
          description="Allow an asset to send it through the smart wallet."
          action={<Button onClick={() => setGranting(true)}>Allow asset</Button>}
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Allowed assets">
          {assets.data.map((asset) => {
            const allowance = allowances.data?.find((item) => item.assetCode === asset.code);
            return (
              <li key={asset.code}>
                <Card>
                  <CardBody className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-fg">{asset.code}</h2>
                      {asset.issuer ? (
                        <AddressDisplay address={asset.issuer} className="text-sm text-fg-muted" />
                      ) : (
                        <span className="text-sm text-fg-muted">Native</span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        aria-label={`Revoke ${asset.code}`}
                        onClick={() => setRevoking(asset.code)}
                      >
                        Revoke
                      </Button>
                    </div>
                    {allowance ? (
                      <AllowanceMeter allowance={allowance} />
                    ) : allowances.isPending ? (
                      <Skeleton className="h-6" />
                    ) : null}
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <RevokeAssetModal assetCode={revoking} account={account} onClose={() => setRevoking(null)} />
      <GrantAssetModal open={granting} onClose={() => setGranting(false)} account={account} existing={assets.data ?? []} />
    </>
  );
}
