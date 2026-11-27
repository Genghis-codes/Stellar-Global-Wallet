"use client";

import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useHealthDetails, useNetworkInfo } from "@/hooks/useServerConfig";
import type { HealthDetails } from "@/lib/api/endpoints/config";
import { describeError } from "@/lib/api/errors";
import { env } from "@/lib/env";

const STATUS_TONE: Record<HealthDetails["status"], BadgeTone> = { ok: "success", degraded: "warning", down: "danger" };
const STATUS_LABEL: Record<HealthDetails["status"], string> = {
  ok: "Operational",
  degraded: "Degraded",
  down: "Down",
};
const CHECK_LABEL: Record<keyof HealthDetails["checks"], string> = {
  horizon: "Horizon",
  rpc: "Soroban RPC",
  postgres: "Database",
  redis: "Cache",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-all text-sm text-fg">{children}</dd>
    </div>
  );
}

/** Which Stellar network and servers the app talks to, and whether they are healthy. */
export function NetworkSettings() {
  const info = useNetworkInfo();
  const health = useHealthDetails();
  const mismatch = info.data && info.data.network !== env.network;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Network" description="The Stellar network this wallet is connected to." />
        <CardBody>
          {info.isPending ? (
            <SkeletonText lines={4} />
          ) : info.isError ? (
            <p className="text-sm text-danger">{describeError(info.error)}</p>
          ) : (
            <>
              {mismatch && (
                <p role="alert" className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
                  The server is on {info.data.network} but this app is built for {env.network}.
                </p>
              )}
              <dl className="divide-y divide-border">
                <Row label="Network">
                  <span className="capitalize">{info.data.network}</span>
                </Row>
                <Row label="Network passphrase">
                  <span className="inline-flex items-center gap-2">
                    {info.data.networkPassphrase}
                    <CopyButton value={info.data.networkPassphrase} label="Copy network passphrase" />
                  </span>
                </Row>
                <Row label="Horizon">{info.data.horizonUrl}</Row>
                <Row label="Soroban RPC">{info.data.sorobanRpcUrl}</Row>
                <Row label="API server">{env.apiUrl}</Row>
              </dl>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Service health"
          description="Live status of the services behind GlobeWallet."
          action={
            <Button variant="secondary" size="sm" loading={health.isFetching} onClick={() => void health.refetch()}>
              Check now
            </Button>
          }
        />
        <CardBody>
          {health.isPending ? (
            <SkeletonText lines={4} />
          ) : health.isError ? (
            <p className="text-sm text-danger">Couldn&apos;t reach the server: {describeError(health.error)}</p>
          ) : (
            <>
              <p className="mb-3 flex items-center gap-2 text-sm text-fg">
                Overall <Badge tone={STATUS_TONE[health.data.status]}>{STATUS_LABEL[health.data.status]}</Badge>
              </p>
              <ul className="divide-y divide-border" aria-label="Dependency checks">
                {(Object.keys(CHECK_LABEL) as (keyof HealthDetails["checks"])[]).map((key) => {
                  const check = health.data.checks[key];
                  return (
                    <li key={key} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="text-fg">{CHECK_LABEL[key]}</span>
                      <span className="flex items-center gap-2 text-fg-muted">
                        {check.skipped ? (
                          <Badge>Not configured</Badge>
                        ) : (
                          <>
                            <span>{check.latencyMs} ms</span>
                            <Badge tone={check.ok ? "success" : "danger"}>{check.ok ? "OK" : "Failing"}</Badge>
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
