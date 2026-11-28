"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Spinner } from "@/components/ui/Spinner";
import { PENDING_POLL_MS } from "@/hooks/useTransaction";
import { api } from "@/lib/api";
import { isInFlightStatus } from "@/lib/api/endpoints/transactions";
import { truncateAddress } from "@/lib/format";
import { queryKeys } from "@/lib/query/keys";

/**
 * Submissions the backend is still tracking for this account. Deployments
 * without status tracking answer 503, and then nothing is shown.
 */
export function PendingSubmissions({ account }: { account: string }) {
  const statuses = useQuery({
    queryKey: queryKeys.account.submissions(account),
    queryFn: ({ signal }) => api.transactions.accountStatuses(account, 20, signal),
    retry: false,
    refetchInterval: (query) => (query.state.data?.some((r) => isInFlightStatus(r.status)) ? PENDING_POLL_MS : false),
  });
  const pending = (statuses.data ?? []).filter((r) => isInFlightStatus(r.status));
  if (pending.length === 0) return null;

  return (
    <div role="status" className="mb-4 rounded-[var(--radius-card)] border border-border bg-info-soft p-4 text-sm text-info">
      <p className="flex items-center gap-2 font-medium">
        <Spinner size="sm" label={null} />
        {pending.length === 1 ? "1 transaction is" : `${pending.length} transactions are`} waiting for the network
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {pending.map((record) => (
          <li key={record.hash}>
            <Link href={`/activity/${record.hash}`} className="font-mono underline">
              {truncateAddress(record.hash, 8, 8)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
