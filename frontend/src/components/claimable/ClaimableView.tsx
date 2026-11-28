"use client";

import type { ReactNode } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { AmountDisplay } from "@/components/ui/AmountDisplay";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useCurrentAccount } from "@/hooks/useAccount";
import { claimableState, useClaimableBalances, type ClaimableState } from "@/hooks/useClaimableBalances";
import { codeFromCanonical } from "@/lib/activity/operations";
import type { ClaimableBalance } from "@/lib/api/endpoints/account";
import { describeError } from "@/lib/api/errors";
import { formatActivityTime } from "@/components/activity/ActivityRow";
import { ClaimActions } from "./ClaimActions";

const STATE_BADGE: Record<ClaimableState, ReactNode> = {
  claimable: <Badge tone="success">Claimable now</Badge>,
  upcoming: <Badge tone="info">Not yet claimable</Badge>,
  expired: <Badge>Expired</Badge>,
};

function windowText(balance: ClaimableBalance, state: ClaimableState): string | null {
  if (state === "upcoming" && balance.claimableAfter) return `Claimable from ${formatActivityTime(balance.claimableAfter)}`;
  if (state === "claimable" && balance.claimableBefore) return `Claim before ${formatActivityTime(balance.claimableBefore)}`;
  if (state === "expired" && balance.claimableBefore) return `Expired ${formatActivityTime(balance.claimableBefore)}`;
  return null;
}

export function ClaimableRow({ balance, account }: { balance: ClaimableBalance; account: string }) {
  const state = claimableState(balance);
  const code = codeFromCanonical(balance.asset) ?? balance.asset;
  const window = windowText(balance, state);
  return (
    <li className="flex flex-wrap items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
          <AmountDisplay amount={balance.amount} asset={code} />
          {STATE_BADGE[state]}
        </p>
        <p className="flex flex-wrap items-center gap-1 text-sm text-fg-muted">
          {balance.sponsor === account ? (
            "Sent by you"
          ) : balance.sponsor ? (
            <>
              From <AddressDisplay address={balance.sponsor} copyable={false} />
            </>
          ) : (
            "Unknown sender"
          )}
          {window && <span>· {window}</span>}
        </p>
      </div>
      <ClaimActions balance={balance} account={account} />
    </li>
  );
}

/** /claimable: balances waiting for this account, with their claim windows. */
export function ClaimableView() {
  const account = useCurrentAccount();
  const balances = useClaimableBalances(account);

  return (
    <>
      <PageHeader
        title="Claimable balances"
        description="Funds sent to you as claimable balances. Claim them to move them into your account."
      />
      {balances.isPending ? (
        <Skeleton aria-label="Loading claimable balances" className="h-48 rounded-[var(--radius-card)]" />
      ) : balances.isError ? (
        <EmptyState
          title="Couldn't load claimable balances"
          description={describeError(balances.error)}
          action={<Button onClick={() => void balances.refetch()}>Try again</Button>}
        />
      ) : balances.data.length === 0 ? (
        <EmptyState title="Nothing to claim" description="When someone sends you a claimable balance it shows up here." />
      ) : (
        <Card>
          <ul aria-label="Claimable balances" className="divide-y divide-border px-5 py-2">
            {balances.data.map((balance) => (
              <ClaimableRow key={balance.id} balance={balance} account={account} />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
