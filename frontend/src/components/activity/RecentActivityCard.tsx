"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { api } from "@/lib/api";
import { renderPayment } from "@/lib/activity/operations";
import { queryKeys } from "@/lib/query/keys";
import { ActivityRow } from "./ActivityRow";
import { FeedSkeleton } from "./FeedSkeleton";

const RECENT = { limit: 5 };

/** Dashboard card with the latest few payments. */
export function RecentActivityCard({ account }: { account: string }) {
  const recent = useQuery({
    queryKey: queryKeys.account.payments(account, RECENT),
    queryFn: ({ signal }) => api.account.payments(account, RECENT, signal),
    refetchInterval: 30_000,
  });

  return (
    <Card>
      <CardHeader
        title="Recent activity"
        action={
          <Link href="/activity" className="text-sm font-medium text-primary hover:underline">
            View all
          </Link>
        }
      />
      <CardBody className="pt-2">
        {recent.isPending ? (
          <FeedSkeleton rows={3} label="Loading recent activity" />
        ) : recent.isError ? (
          <p className="text-sm text-fg-muted">Recent activity is unavailable right now.</p>
        ) : recent.data.items.length === 0 ? (
          <p className="text-sm text-fg-muted">No payments yet.</p>
        ) : (
          <ul aria-label="Recent activity" className="flex flex-col divide-y divide-border">
            {recent.data.items.map((item) => (
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
      </CardBody>
    </Card>
  );
}
