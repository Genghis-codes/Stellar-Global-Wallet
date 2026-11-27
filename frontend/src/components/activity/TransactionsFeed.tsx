"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { isUnfundedAccountError } from "@/hooks/useAccount";
import { useTransactionsFeed } from "@/hooks/useActivity";
import type { RenderedOperation } from "@/lib/activity/operations";
import type { TransactionSummary } from "@/lib/api/endpoints/account";
import { describeError } from "@/lib/api/errors";
import { ActivityRow } from "./ActivityRow";
import { FeedFooter } from "./FeedFooter";
import { FeedSkeleton } from "./FeedSkeleton";

export function renderTransactionSummary(tx: TransactionSummary): RenderedOperation {
  const count = tx.operation_count;
  return {
    kind: "other",
    title: `Transaction · ${count} ${count === 1 ? "operation" : "operations"}`,
    description: tx.memo ? `Memo: ${tx.memo}` : `Ledger ${tx.ledger}`,
    amount: null,
    assetCode: null,
    sign: null,
    counterparty: null,
    failed: false,
  };
}

/** Every transaction the account took part in, including non-payment ones. */
export function TransactionsFeed({ account }: { account: string }) {
  const feed = useTransactionsFeed(account);
  const items = useMemo(() => feed.data?.pages.flatMap((page) => page.items) ?? [], [feed.data]);

  if (feed.isPending) return <FeedSkeleton label="Loading transactions" />;
  if (feed.isError) {
    if (isUnfundedAccountError(feed.error)) {
      return <EmptyState title="No transactions yet" description="This account hasn't been funded on the network yet." />;
    }
    return (
      <EmptyState
        title="Couldn't load your transactions"
        description={describeError(feed.error)}
        action={<Button onClick={() => void feed.refetch()}>Try again</Button>}
      />
    );
  }
  if (items.length === 0) {
    return <EmptyState title="No transactions yet" description="Transactions involving your account will show up here." />;
  }

  return (
    <div className="flex flex-col">
      <ul aria-label="Transactions" className="flex flex-col divide-y divide-border">
        {items.map((tx) => (
          <ActivityRow key={tx.id} op={renderTransactionSummary(tx)} timestamp={tx.created_at} href={`/activity/${tx.hash}`} />
        ))}
      </ul>
      <FeedFooter hasMore={Boolean(feed.hasNextPage)} loading={feed.isFetchingNextPage} onLoadMore={() => void feed.fetchNextPage()} />
    </div>
  );
}
