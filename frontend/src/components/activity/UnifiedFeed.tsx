"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useActivityFeed } from "@/hooks/useActivity";
import { renderActivityItem } from "@/lib/activity/operations";
import type { ActivityItem } from "@/lib/api/endpoints/account";
import { isTransactionHash } from "@/lib/api/endpoints/transactions";
import { describeError } from "@/lib/api/errors";
import { ActivityRow } from "./ActivityRow";
import { FeedFooter } from "./FeedFooter";
import { FeedSkeleton } from "./FeedSkeleton";

/** Transaction hash an activity item points at, when the backend includes one. */
export function activityItemHash(item: ActivityItem): string | null {
  const hash = item.details.transactionHash;
  return typeof hash === "string" && isTransactionHash(hash) ? hash : null;
}

/** Unified timeline: payments plus Soroban contract events and claimable balances. */
export function UnifiedFeed({ account }: { account: string }) {
  const feed = useActivityFeed(account);
  const items = useMemo(() => feed.data?.pages.flatMap((page) => page.items) ?? [], [feed.data]);

  if (feed.isPending) return <FeedSkeleton />;
  if (feed.isError) {
    return (
      <EmptyState
        title="Couldn't load your activity"
        description={describeError(feed.error)}
        action={<Button onClick={() => void feed.refetch()}>Try again</Button>}
      />
    );
  }
  if (items.length === 0) {
    return <EmptyState title="No activity yet" description="Payments, contract events and claimable balances show up here." />;
  }

  return (
    <div className="flex flex-col">
      <ul aria-label="All activity" className="flex flex-col divide-y divide-border">
        {items.map((item) => {
          const hash = activityItemHash(item);
          return (
            <ActivityRow
              key={`${item.source}:${item.id}`}
              op={renderActivityItem(item)}
              timestamp={item.timestamp}
              href={hash ? `/activity/${hash}` : undefined}
            />
          );
        })}
      </ul>
      <FeedFooter hasMore={Boolean(feed.hasNextPage)} loading={feed.isFetchingNextPage} onLoadMore={() => void feed.fetchNextPage()} />
    </div>
  );
}
