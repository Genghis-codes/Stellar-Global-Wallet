"use client";

import { useState } from "react";
import Link from "next/link";
import { RefreshIcon } from "@/components/icons";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { describeError } from "@/lib/api/errors";
import { useAccountSigners, useCurrentAccount } from "@/hooks/useAccount";
import { usePendingTxs } from "@/hooks/usePendingTxs";
import { isOpen } from "@/lib/multisig/pendingTx";
import { canRemoveSigner } from "@/lib/multisig/thresholds";
import { AddSignerModal } from "./AddSignerModal";
import { EditThresholdsModal } from "./EditThresholdsModal";
import { RemoveSignerModal } from "./RemoveSignerModal";
import { SignerList } from "./SignerList";
import { ThresholdsCard } from "./ThresholdsCard";

export function SignersView() {
  const account = useCurrentAccount();
  const signers = useAccountSigners(account);
  const pendingTxs = usePendingTxs(signers.data?.isMultisig ? account : null);
  const openCount = pendingTxs.data?.filter(isOpen).length ?? 0;
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  return (
    <>
      <PageHeader
        title="Signers"
        description="Who can sign for this account, and how much weight each action needs."
        actions={
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshIcon className="h-4 w-4" />}
            loading={signers.isFetching}
            onClick={() => void signers.refetch()}
          >
            Refresh
          </Button>
        }
      />
      {signers.isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading signers">
          <Skeleton className="h-40 rounded-[var(--radius-card)]" />
          <Skeleton className="h-48 rounded-[var(--radius-card)]" />
        </div>
      ) : signers.isError ? (
        <EmptyState
          title="Couldn't load signers"
          description={describeError(signers.error)}
          action={<Button onClick={() => void signers.refetch()}>Try again</Button>}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {openCount > 0 && (
            <p role="status" className="rounded-lg bg-info-soft p-3 text-sm text-info">
              {openCount} transaction{openCount === 1 ? " is" : "s are"} waiting for signatures.{" "}
              <Link href="/security/pending" className="font-medium underline">
                Review pending
              </Link>
            </p>
          )}
          <ThresholdsCard
            info={signers.data}
            action={
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            }
          />
          {editing && (
            <EditThresholdsModal open onClose={() => setEditing(false)} info={signers.data} account={account} />
          )}
          <SignerList
            info={signers.data}
            account={account}
            action={
              <Button size="sm" onClick={() => setAdding(true)}>
                Add signer
              </Button>
            }
            renderActions={(signer) => {
              if (signer.isMaster) return null;
              const verdict = canRemoveSigner(signers.data, signer.key);
              return (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!verdict.ok}
                  title={verdict.reason}
                  aria-label={`Remove signer ${signer.key}`}
                  onClick={() => setRemoving(signer.key)}
                >
                  Remove
                </Button>
              );
            }}
          />
          <RemoveSignerModal
            signer={removing}
            onClose={() => setRemoving(null)}
            info={signers.data}
            account={account}
          />
          <AddSignerModal open={adding} onClose={() => setAdding(false)} info={signers.data} account={account} />
        </div>
      )}
    </>
  );
}
