"use client";

import { useState } from "react";
import { PenIcon, RefreshIcon } from "@/components/icons";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { describeError } from "@/lib/api/errors";
import type { PendingTx } from "@/lib/api/endpoints/pendingTxs";
import { isOpen } from "@/lib/multisig/pendingTx";
import { useCurrentAccount } from "@/hooks/useAccount";
import { usePendingTxs } from "@/hooks/usePendingTxs";
import { PendingTxCard } from "./PendingTxCard";
import { PendingTxActions } from "./PendingTxActions";
import { PendingTxDetailModal } from "./PendingTxDetailModal";

/** Open transactions first, newest first within each group. */
function sortPending(items: PendingTx[]): PendingTx[] {
  return [...items].sort(
    (a, b) => Number(isOpen(b)) - Number(isOpen(a)) || Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

export function PendingTxsView() {
  const account = useCurrentAccount();
  const pending = usePendingTxs(account);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = pending.data?.find((tx) => tx.id === selectedId) ?? null;

  return (
    <>
      <PageHeader
        title="Pending transactions"
        description="Multisig transactions waiting for more signatures."
        actions={
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshIcon className="h-4 w-4" />}
            loading={pending.isFetching}
            onClick={() => void pending.refetch()}
          >
            Refresh
          </Button>
        }
      />
      {pending.isPending ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading pending transactions">
          <Skeleton className="h-28 rounded-[var(--radius-card)]" />
          <Skeleton className="h-28 rounded-[var(--radius-card)]" />
        </div>
      ) : pending.isError ? (
        <EmptyState
          title="Couldn't load pending transactions"
          description={describeError(pending.error)}
          action={<Button onClick={() => void pending.refetch()}>Try again</Button>}
        />
      ) : pending.data.length === 0 ? (
        <EmptyState
          icon={<PenIcon />}
          title="Nothing to sign"
          description="When a signer shares a transaction for this account, it shows up here."
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Pending transactions">
          {sortPending(pending.data).map((tx) => (
            <li key={tx.id}>
              <PendingTxCard
                tx={tx}
                account={account}
                action={
                  <Button variant="secondary" size="sm" onClick={() => setSelectedId(tx.id)}>
                    Details
                  </Button>
                }
              />
            </li>
          ))}
        </ul>
      )}
      <PendingTxDetailModal
        tx={selected}
        onClose={() => setSelectedId(null)}
        dismissible={!busy}
        actions={selected && <PendingTxActions tx={selected} account={account} onBusyChange={setBusy} />}
      />
    </>
  );
}
