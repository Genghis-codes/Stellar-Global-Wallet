"use client";

import type { ReactNode } from "react";
import { AlertIcon, ExternalLinkIcon } from "@/components/icons";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { txUrl } from "@/lib/stellar/explorer";
import { cn } from "@/lib/cn";

export type TxResultStatus = "success" | "pending" | "failed";

export interface TxResultProps {
  status: TxResultStatus;
  /** Transaction hash (success / pending). */
  hash?: string;
  title?: string;
  /** What happened, e.g. "Sent 10 XLM to GABC…XYZ". */
  summary?: ReactNode;
  /** Error sentence for failures. */
  error?: string;
  /** Extra actions (fee bump, view activity ...). */
  actions?: ReactNode;
  onDone?: () => void;
  onRetry?: () => void;
  doneLabel?: string;
}

const DEFAULT_TITLES: Record<TxResultStatus, string> = {
  success: "Transaction successful",
  pending: "Waiting for the network",
  failed: "Transaction failed",
};

/** Final step of a signing flow: success, pending (timed out) or failure, with an explorer link. */
export function TxResult({ status, hash, title, summary, error, actions, onDone, onRetry, doneLabel = "Done" }: TxResultProps) {
  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-4 py-8 text-center">
        <span
          aria-hidden="true"
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-full text-xl font-semibold",
            status === "success" && "bg-success-soft text-success",
            status === "pending" && "bg-warning-soft text-warning",
            status === "failed" && "bg-danger-soft text-danger",
          )}
        >
          {status === "success" ? "✓" : <AlertIcon className="h-6 w-6" />}
        </span>
        <div role={status === "failed" ? "alert" : "status"}>
          <h2 className="text-lg font-semibold text-fg">{title ?? DEFAULT_TITLES[status]}</h2>
          {summary && <p className="mt-1 text-sm text-fg-muted">{summary}</p>}
          {status === "pending" && (
            <p className="mt-1 text-sm text-fg-muted">
              The network didn&apos;t confirm in time. The transaction may still land; check the explorer before trying
              again.
            </p>
          )}
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>
        {hash && (
          <div className="flex flex-col items-center gap-1 text-sm">
            <AddressDisplay address={hash} chars={8} />
            <a
              href={txUrl(hash)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              View on explorer <ExternalLinkIcon className="h-3.5 w-3.5" />
            </a>
          </div>
        )}
        {actions}
        <div className="flex gap-2">
          {onRetry && (
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          )}
          {onDone && <Button onClick={onDone}>{doneLabel}</Button>}
        </div>
      </CardBody>
    </Card>
  );
}
