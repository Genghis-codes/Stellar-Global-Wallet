"use client";

import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useCurrentAccount } from "@/hooks/useAccount";
import { useAppConfig } from "@/hooks/useServerConfig";
import { useContractAdmin, useContractStatus, useRecoveryState } from "@/hooks/useSmartWallet";

const SECTIONS = [
  {
    href: "/security/smart-wallet/limits",
    title: "Spend limits",
    description: "Cap how much can leave the wallet per asset in any 24 hours.",
  },
  {
    href: "/security/smart-wallet/allowances",
    title: "Allowances",
    description: "Assets the wallet may spend, and what's left of each limit today.",
  },
  {
    href: "/security/smart-wallet/guardians",
    title: "Guardians",
    description: "Trusted accounts that can recover the wallet.",
  },
  {
    href: "/security/smart-wallet/recovery",
    title: "Recovery",
    description: "Start, approve or follow a social recovery.",
  },
];

export function SmartWalletView() {
  const account = useCurrentAccount();
  const config = useAppConfig();
  const status = useContractStatus();
  const admin = useContractAdmin();
  const recovery = useRecoveryState();
  const contractId = config.data?.contracts.globeWallet.contractId;

  return (
    <>
      <PageHeader title="Smart wallet" description="Protections enforced on-chain by the GlobeWallet Soroban contract." />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Contract" />
          <CardBody>
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-fg-muted">Contract id</dt>
                <dd className="mt-1">{contractId ? <AddressDisplay address={contractId} copyable /> : <Skeleton className="h-5 w-32" />}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Admin</dt>
                <dd className="mt-1 flex flex-wrap items-center gap-2">
                  {admin.data ? (
                    <>
                      <AddressDisplay address={admin.data.admin} />
                      {admin.data.admin === account && <Badge>You</Badge>}
                    </>
                  ) : admin.isError ? (
                    "Unavailable"
                  ) : (
                    <Skeleton className="h-5 w-32" />
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">Sends</dt>
                <dd className="mt-1">
                  {status.data ? (
                    status.data.sendsPaused ? (
                      <Badge tone="danger">Paused</Badge>
                    ) : (
                      <Badge tone="success">Active</Badge>
                    )
                  ) : status.isError ? (
                    "Unavailable"
                  ) : (
                    <Skeleton className="h-5 w-16" />
                  )}
                </dd>
              </div>
            </dl>
            {recovery.data?.proposal && (
              <p className="mt-4 rounded-lg bg-warning-soft p-3 text-sm text-warning">
                A recovery is in progress.{" "}
                <Link href="/security/smart-wallet/recovery" className="font-medium underline">
                  Review it
                </Link>
                .
              </p>
            )}
          </CardBody>
        </Card>
        <ul className="grid gap-4 sm:grid-cols-2">
          {SECTIONS.map((section) => (
            <li key={section.href}>
              <Link
                href={section.href}
                className="block h-full rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-sm transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <h2 className="text-base font-semibold text-fg">{section.title}</h2>
                <p className="mt-1 text-sm text-fg-muted">{section.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
