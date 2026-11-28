"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { assetOptions } from "@/components/send/AssetPicker";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { isUnfundedAccountError, useAccountReserves, useCurrentAccount } from "@/hooks/useAccount";
import { useFeatureFlags } from "@/hooks/useServerConfig";
import { describeError } from "@/lib/api/errors";
import { SwapForm, type SwapDraft } from "./SwapForm";
import { SwapReviewModal } from "./SwapReviewModal";

/** /swap: convert between assets the account holds via a path payment to itself. */
export function SwapView() {
  const account = useCurrentAccount();
  const flags = useFeatureFlags();
  const reserves = useAccountReserves(account);
  const options = useMemo(() => (reserves.data ? assetOptions(reserves.data.balances) : []), [reserves.data]);
  const [draft, setDraft] = useState<SwapDraft | null>(null);
  // Remount the form after a swap so it starts from fresh balances.
  const [formKey, setFormKey] = useState(0);

  let body: React.ReactNode;
  if (flags.isPending || reserves.isPending) {
    body = <Skeleton className="h-96 rounded-[var(--radius-card)]" />;
  } else if (flags.data && !flags.data.pathPayments) {
    body = <EmptyState title="Swaps aren't available" description="Path payments are turned off on this server." />;
  } else if (reserves.isError) {
    body = isUnfundedAccountError(reserves.error) ? (
      <EmptyState title="Fund your account first" description="An account needs XLM on the network before it can swap." />
    ) : (
      <EmptyState title="Couldn't load your balances" description={describeError(reserves.error)} />
    );
  } else if (options.length < 2) {
    body = (
      <EmptyState
        title="Add another asset to swap"
        description="You can only swap into assets you hold a trustline for."
        action={
          <Link href="/assets" className="text-sm font-medium text-primary hover:underline">
            Manage assets
          </Link>
        }
      />
    );
  } else {
    body = (
      <Card>
        <CardBody>
          <SwapForm key={formKey} options={options} onReview={setDraft} />
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Swap" description="Convert between your assets at the best rate on the Stellar DEX." />
      {body}
      <SwapReviewModal
        draft={draft}
        onClose={() => setDraft(null)}
        onDone={() => setFormKey((key) => key + 1)}
      />
    </div>
  );
}
