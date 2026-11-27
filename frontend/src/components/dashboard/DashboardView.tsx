"use client";

import { RefreshIcon } from "@/components/icons";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { describeError } from "@/lib/api/errors";
import { isUnfundedAccountError, useAccountReserves, useCurrentAccount } from "@/hooks/useAccount";
import { usePortfolioValue } from "@/hooks/usePrices";
import { BalanceList } from "./BalanceList";
import { BalanceSummary } from "./BalanceSummary";
import { PortfolioValueCard } from "./PortfolioValueCard";
import { UnfundedAccount } from "./UnfundedAccount";

export function DashboardView() {
  const account = useCurrentAccount();
  const reserves = useAccountReserves(account);
  const portfolio = usePortfolioValue(account);
  const xlm = reserves.data?.balances.find((line) => line.asset_type === "native")?.balance ?? "0";

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your balances on the Stellar network."
        actions={
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshIcon className="h-4 w-4" />}
            loading={reserves.isFetching}
            onClick={() => void reserves.refetch()}
          >
            Refresh
          </Button>
        }
      />

      {reserves.isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading balances">
          <Skeleton className="h-32 rounded-[var(--radius-card)]" />
          <Skeleton className="h-64 rounded-[var(--radius-card)]" />
        </div>
      ) : reserves.isError ? (
        isUnfundedAccountError(reserves.error) ? (
          <UnfundedAccount account={account} />
        ) : (
          <EmptyState
            title="Couldn't load your balances"
            description={describeError(reserves.error)}
            action={<Button onClick={() => void reserves.refetch()}>Try again</Button>}
          />
        )
      ) : (
        <div className="flex flex-col gap-4">
          <PortfolioValueCard portfolio={portfolio} />
          <BalanceSummary xlmBalance={xlm} reserves={reserves.data.reserves} />
          <BalanceList balances={reserves.data.balances} />
        </div>
      )}
    </>
  );
}
