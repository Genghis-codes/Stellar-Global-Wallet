"use client";

import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { describeError } from "@/lib/api/errors";
import { formatDuration, ledgersToMs } from "@/lib/countdown";
import { useCurrentAccount } from "@/hooks/useAccount";
import { useContractAdmin, useRecoveryState } from "@/hooks/useSmartWallet";
import { GuardianChangeModal, type GuardianChange } from "./GuardianChangeModal";

export function GuardiansView() {
  const account = useCurrentAccount();
  const recovery = useRecoveryState();
  const admin = useContractAdmin();
  const [change, setChange] = useState<GuardianChange | null>(null);
  const isAdmin = admin.data?.admin === account;

  return (
    <>
      <PageHeader title="Guardians" description="Trusted accounts that can together hand the wallet to a new key." />
      {recovery.isPending ? (
        <Skeleton className="h-48 rounded-[var(--radius-card)]" />
      ) : recovery.isError ? (
        <EmptyState
          title="Couldn't load guardians"
          description={describeError(recovery.error)}
          action={<Button onClick={() => void recovery.refetch()}>Try again</Button>}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Recovery threshold" />
            <CardBody>
              {recovery.data.config ? (
                <p className="text-sm text-fg">
                  <strong>{recovery.data.config.threshold}</strong> of {recovery.data.guardianCount} guardians must approve,
                  then the wallet waits about{" "}
                  <strong>{formatDuration(ledgersToMs(recovery.data.config.delayInLedgers))}</strong> (
                  {recovery.data.config.delayInLedgers} ledgers) before the recovery can run.
                </p>
              ) : (
                <p className="text-sm text-fg-muted">
                  Recovery isn&apos;t configured on this contract yet, so guardians can&apos;t start a recovery.
                </p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Guardians"
              description={`${recovery.data.guardianCount} registered`}
              action={
                isAdmin && (
                  <Button size="sm" onClick={() => setChange({ kind: "add" })} disabled={Boolean(recovery.data.proposal)}>
                    Add guardian
                  </Button>
                )
              }
            />
            <CardBody>
              {recovery.data.guardians.length === 0 ? (
                <p className="text-sm text-fg-muted">No guardians yet.</p>
              ) : (
                <ul className="divide-y divide-border" aria-label="Guardians">
                  {recovery.data.guardians.map((guardian) => (
                    <li key={guardian} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="flex items-center gap-2">
                        <AddressDisplay address={guardian} copyable />
                        {guardian === account && <Badge>You</Badge>}
                      </div>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove guardian ${guardian}`}
                          onClick={() => setChange({ kind: "remove", guardian })}
                        >
                          Remove
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          {recovery.data.proposal && isAdmin && (
            <p className="text-sm text-warning">Guardians are frozen while a recovery is in progress.</p>
          )}
          {isAdmin && (
            <GuardianChangeModal change={change} state={recovery.data} admin={account} onClose={() => setChange(null)} />
          )}
          {admin.data && !isAdmin && (
            <p className="text-sm text-fg-muted">Only the contract admin can add or remove guardians.</p>
          )}
        </div>
      )}
    </>
  );
}
