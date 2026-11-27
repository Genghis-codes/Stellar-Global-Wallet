"use client";

import { version as reactVersion, type ReactNode } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useAppConfig } from "@/hooks/useServerConfig";
import { describeError } from "@/lib/api/errors";
import { APP_VERSION, COMMIT_SHA, isClientOutdated } from "@/lib/version";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="font-mono text-fg">{children}</dd>
    </div>
  );
}

/** App and server versions, plus a warning when the server needs a newer app. */
export function AboutSettings() {
  const config = useAppConfig();
  const outdated = config.data ? isClientOutdated(APP_VERSION, config.data.minClientVersion) : false;

  return (
    <Card>
      <CardHeader
        title="About GlobeWallet"
        description="A non-custodial Stellar wallet. Your keys stay in your wallet."
      />
      <CardBody>
        {outdated && (
          <p role="alert" className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
            This version of the app is older than the server supports ({config.data?.minClientVersion}). Reload to
            update.
          </p>
        )}
        <dl className="divide-y divide-border">
          <Row label="App version">{APP_VERSION}</Row>
          {COMMIT_SHA && <Row label="Build">{COMMIT_SHA.slice(0, 7)}</Row>}
          <Row label="React">{reactVersion}</Row>
          {config.isPending ? (
            <div className="py-2">
              <SkeletonText lines={2} />
            </div>
          ) : config.isError ? (
            <div className="py-2 text-sm text-danger">{describeError(config.error)}</div>
          ) : (
            <>
              <Row label="API version">{config.data.apiVersion}</Row>
              {config.data.minClientVersion && <Row label="Minimum app version">{config.data.minClientVersion}</Row>}
              <Row label="Wallet contract">
                {config.data.features.contract && config.data.contracts.globeWallet.contractId
                  ? `${config.data.contracts.globeWallet.contractId.slice(
                      0,
                      6
                    )}…${config.data.contracts.globeWallet.contractId.slice(-6)}`
                  : "Not deployed"}
              </Row>
            </>
          )}
        </dl>
      </CardBody>
    </Card>
  );
}
