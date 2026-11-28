"use client";

import { useState } from "react";
import { RefreshIcon } from "@/components/icons";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { describeError } from "@/lib/api/errors";
import type { SpendAllowance } from "@/lib/api/endpoints/contract";
import { useCurrentAccount } from "@/hooks/useAccount";
import { usePendingSpendLimits } from "@/hooks/usePendingSpendLimits";
import { useSpendAllowances } from "@/hooks/useSmartWallet";
import { AllowanceMeter } from "./AllowanceMeter";
import { PendingIncreases } from "./PendingIncreases";
import { SetSpendLimitModal } from "./SetSpendLimitModal";

export function SpendLimitsView() {
  const account = useCurrentAccount();
  const allowances = useSpendAllowances(account);
  const pending = usePendingSpendLimits(account);
  const [editing, setEditing] = useState<SpendAllowance | null>(null);

  return (
    <>
      <PageHeader
        title="Spend limits"
        description="Lowering a limit applies at once. Raising or removing one waits 24 hours, so a stolen key can't lift it."
        actions={
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshIcon className="h-4 w-4" />}
            loading={allowances.isFetching}
            onClick={() => void allowances.refetch()}
          >
            Refresh
          </Button>
        }
      />
      {allowances.isPending ? (
        <Skeleton className="h-40 rounded-[var(--radius-card)]" />
      ) : allowances.isError ? (
        <EmptyState
          title="Couldn't load spend limits"
          description={describeError(allowances.error)}
          action={<Button onClick={() => void allowances.refetch()}>Try again</Button>}
        />
      ) : allowances.data.length === 0 ? (
        <EmptyState
          title="No assets on the wallet yet"
          description="Add an asset under Allowances to set a limit for it."
        />
      ) : (
        <div className="flex flex-col gap-4">
        <PendingIncreases
          account={account}
          // Drop entries the contract has already applied or discarded.
          items={pending.items.filter((item) =>
            allowances.data.some((a) => a.assetCode === item.assetCode && a.limit === item.previousLimit),
          )}
          onRemove={pending.remove}
        />
        <ul className="flex flex-col gap-3" aria-label="Spend limits">
          {allowances.data.map((allowance) => (
            <li key={allowance.assetCode}>
              <Card>
                <CardBody className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold text-fg">{allowance.assetCode}</h2>
                      {allowance.unlimited ? <Badge>Unlimited</Badge> : <Badge tone="info">24 h limit</Badge>}
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => setEditing(allowance)}>
                      Change limit
                    </Button>
                  </div>
                  <AllowanceMeter allowance={allowance} />
                  {allowance.nextRefillAt && (
                    <p className="text-xs text-fg-muted">
                      More becomes available from {new Date(allowance.nextRefillAt).toLocaleString()}.
                    </p>
                  )}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
        </div>
      )}
      <SetSpendLimitModal allowance={editing} account={account} onClose={() => setEditing(null)} onQueued={pending.save} />
    </>
  );
}
