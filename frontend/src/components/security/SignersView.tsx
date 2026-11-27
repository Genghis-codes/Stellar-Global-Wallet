"use client";

import { useState } from "react";
import { RefreshIcon } from "@/components/icons";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { describeError } from "@/lib/api/errors";
import { useAccountSigners, useCurrentAccount } from "@/hooks/useAccount";
import { AddSignerModal } from "./AddSignerModal";
import { SignerList } from "./SignerList";
import { ThresholdsCard } from "./ThresholdsCard";

export function SignersView() {
  const account = useCurrentAccount();
  const signers = useAccountSigners(account);
  const [adding, setAdding] = useState(false);

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
          <ThresholdsCard info={signers.data} />
          <SignerList
            info={signers.data}
            account={account}
            action={
              <Button size="sm" onClick={() => setAdding(true)}>
                Add signer
              </Button>
            }
          />
          <AddSignerModal open={adding} onClose={() => setAdding(false)} info={signers.data} account={account} />
        </div>
      )}
    </>
  );
}
