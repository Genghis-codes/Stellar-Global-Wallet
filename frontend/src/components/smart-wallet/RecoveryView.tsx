"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Countdown } from "@/components/ui/Countdown";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { describeError } from "@/lib/api/errors";
import { recoveryPermissions, recoveryTimeline } from "@/lib/contract/recovery";
import { useCurrentAccount } from "@/hooks/useAccount";
import { useContractAdmin, useRecoveryState } from "@/hooks/useSmartWallet";
import { RecoveryActions } from "./RecoveryActions";
import { RecoveryTimeline } from "./RecoveryTimeline";

export function RecoveryView() {
  const account = useCurrentAccount();
  const recovery = useRecoveryState();
  const admin = useContractAdmin();

  return (
    <>
      <PageHeader
        title="Social recovery"
        description="If the admin key is lost, guardians can hand the wallet to a new key after a waiting period."
      />
      {recovery.isPending ? (
        <Skeleton className="h-64 rounded-[var(--radius-card)]" />
      ) : recovery.isError ? (
        <EmptyState
          title="Couldn't load the recovery state"
          description={describeError(recovery.error)}
          action={<Button onClick={() => void recovery.refetch()}>Try again</Button>}
        />
      ) : !recovery.data.configured ? (
        <EmptyState
          title="Recovery isn't set up"
          description="The contract admin has to configure a guardian threshold and delay first."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <Card>
            <CardHeader
              title={recovery.data.proposal ? "Recovery in progress" : "No recovery in progress"}
              action={
                recovery.data.proposal?.executableAt &&
                !recovery.data.proposal.executable && (
                  <Badge tone="warning">
                    Unlocks in <Countdown target={recovery.data.proposal.executableAt} />
                  </Badge>
                )
              }
            />
            <CardBody className="flex flex-col gap-5">
              {recovery.data.proposal && (
                <p className="text-sm text-fg">
                  Proposed new admin: <AddressDisplay address={recovery.data.proposal.newAdmin} copyable />
                </p>
              )}
              <RecoveryTimeline steps={recoveryTimeline(recovery.data)} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Your options" />
            <CardBody>
              <RecoveryActions
                account={account}
                state={recovery.data}
                permissions={recoveryPermissions(account, recovery.data, admin.data?.admin)}
              />
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
