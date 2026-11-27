"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { usePaymentsFeed } from "@/hooks/useActivity";
import {
  DEFAULT_FILTERS,
  assetOptions,
  filterPayments,
  hasActiveFilters,
  isPastDateRange,
  type ActivityFilters as Filters,
} from "@/lib/activity/filters";
import { renderPayment } from "@/lib/activity/operations";
import { describeError } from "@/lib/api/errors";
import { isUnfundedAccountError } from "@/hooks/useAccount";
import { ActivityFilters } from "./ActivityFilters";
import { ActivityRow } from "./ActivityRow";
import { FeedFooter } from "./FeedFooter";
import { FeedSkeleton } from "./FeedSkeleton";

export interface PaymentsFeedProps {
  account: string;
  filters: Filters;
  onFiltersChange: (next: Filters) => void;
}

/** Payments, path payments and account create/merge, filterable, with infinite scroll. */
export function PaymentsFeed({ account, filters, onFiltersChange }: PaymentsFeedProps) {
  const feed = usePaymentsFeed(account);
  const all = useMemo(() => feed.data?.pages.flatMap((page) => page.items) ?? [], [feed.data]);
  const visible = useMemo(() => filterPayments(all, filters, account), [all, filters, account]);
  const assets = useMemo(() => assetOptions(all), [all]);
  const exhausted = isPastDateRange(all.at(-1), filters);
  const hasMore = Boolean(feed.hasNextPage) && !exhausted;
  const filtered = hasActiveFilters(filters);

  if (feed.isPending) return <FeedSkeleton />;
  if (feed.isError) {
    if (isUnfundedAccountError(feed.error)) {
      return <EmptyState title="No activity yet" description="This account hasn't been funded on the network yet." />;
    }
    return (
      <EmptyState
        title="Couldn't load your activity"
        description={describeError(feed.error)}
        action={<Button onClick={() => void feed.refetch()}>Try again</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ActivityFilters value={filters} onChange={onFiltersChange} assets={assets} />
      {visible.length === 0 ? (
        all.length === 0 ? (
          <EmptyState title="No payments yet" description="Payments you send and receive will show up here." />
        ) : (
          <EmptyState
            title="No matching activity"
            description={hasMore ? "Nothing in the loaded history matches. Load older activity or change the filters." : "Nothing matches these filters."}
            action={
              <Button variant="secondary" onClick={() => onFiltersChange(DEFAULT_FILTERS)}>
                Clear filters
              </Button>
            }
          />
        )
      ) : (
        <ul aria-label={filtered ? "Filtered payments" : "Payments"} className="flex flex-col divide-y divide-border">
          {visible.map((item) => (
            <ActivityRow
              key={item.id}
              op={renderPayment(item, account)}
              timestamp={item.createdAt}
              flags={item.flags}
              href={`/activity/${item.transactionHash}`}
            />
          ))}
        </ul>
      )}
      {all.length > 0 && (
        <FeedFooter hasMore={hasMore} loading={feed.isFetchingNextPage} onLoadMore={() => void feed.fetchNextPage()} />
      )}
    </div>
  );
}
