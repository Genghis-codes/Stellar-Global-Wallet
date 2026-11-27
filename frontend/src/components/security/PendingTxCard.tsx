import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { Countdown } from "@/components/ui/Countdown";
import type { PendingTx } from "@/lib/api/endpoints/pendingTxs";
import { truncateAddress } from "@/lib/format";
import { PENDING_STATUS, hasSigned, isOpen, signingProgress } from "@/lib/multisig/pendingTx";

export interface PendingTxCardProps {
  tx: PendingTx;
  account: string;
  action?: ReactNode;
}

/** One pending multisig transaction: status, signing progress and expiry. */
export function PendingTxCard({ tx, account, action }: PendingTxCardProps) {
  const status = PENDING_STATUS[tx.status];
  const progress = signingProgress(tx);
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            {hasSigned(tx, account) && <Badge tone="success">You signed</Badge>}
            <span className="font-mono text-sm text-fg">{truncateAddress(tx.hash, 8, 8)}</span>
          </div>
          {action}
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs text-fg-muted">
            <span>
              Weight {tx.collectedWeight} of {tx.requiredWeight}
            </span>
            <span>
              {tx.collectedSigners.length} signature{tx.collectedSigners.length === 1 ? "" : "s"}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Signing progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="h-2 overflow-hidden rounded-full bg-surface-muted"
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <p className="text-xs text-fg-muted">
          Created by {tx.createdBy === account ? "you" : truncateAddress(tx.createdBy)} on{" "}
          {new Date(tx.createdAt).toLocaleString()}
          {tx.expiresAt && isOpen(tx) && (
            <>
              {" "}
              · expires in <Countdown target={tx.expiresAt} doneLabel="moments" />
            </>
          )}
        </p>
      </CardBody>
    </Card>
  );
}
