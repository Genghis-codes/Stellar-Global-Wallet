"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ExternalLinkIcon } from "@/components/icons";
import { PageHeader } from "@/components/layout/PageHeader";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { AmountDisplay } from "@/components/ui/AmountDisplay";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { useCurrentAccount } from "@/hooks/useAccount";
import { PENDING_MAX_POLLS, isTransactionNotFound, useTransaction, useTransactionSignatures } from "@/hooks/useTransaction";
import { isTransactionHash, type TransactionDetail } from "@/lib/api/endpoints/transactions";
import { describeError } from "@/lib/api/errors";
import { truncateAddress } from "@/lib/format";
import { accountUrl, txUrl } from "@/lib/stellar/explorer";
import { formatActivityTime } from "./ActivityRow";
import { OperationList } from "./OperationList";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-all text-sm font-medium text-fg sm:text-right">{children}</dd>
    </div>
  );
}

function Signatures({ hash }: { hash: string }) {
  const signatures = useTransactionSignatures(hash);
  return (
    <Card>
      <CardHeader
        title="Signatures"
        description={signatures.data ? `${signatures.data.length} ${signatures.data.length === 1 ? "signature" : "signatures"}` : undefined}
      />
      <CardBody className="pt-3">
        {signatures.isPending ? (
          <Skeleton className="h-6 w-full" />
        ) : signatures.isError ? (
          <p className="text-sm text-fg-muted">Signatures are unavailable right now.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {signatures.data.map((signature) => (
              <li key={signature} className="break-all rounded-lg bg-surface-muted px-3 py-2 font-mono text-xs text-fg">
                {signature}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

const MEMO_TYPES: Record<string, string> = { text: "Text", id: "ID", hash: "Hash", return: "Return" };

function Summary({ tx, account }: { tx: TransactionDetail; account: string }) {
  return (
    <Card>
      <CardHeader
        title="Summary"
        action={tx.successful ? <Badge tone="success">Successful</Badge> : <Badge tone="danger">Failed</Badge>}
      />
      <CardBody className="pt-2">
        <dl className="divide-y divide-border">
          <Row label="Hash">
            <span className="inline-flex items-center gap-2">
              <span className="font-mono">{truncateAddress(tx.hash, 10, 10)}</span>
              <CopyButton value={tx.hash} label="Copy hash" />
            </span>
          </Row>
          <Row label="Date">
            <time dateTime={tx.createdAt}>{formatActivityTime(tx.createdAt)}</time>
          </Row>
          <Row label="Ledger">{tx.ledger}</Row>
          <Row label="Source account">
            <AddressDisplay address={tx.sourceAccount} href={accountUrl(tx.sourceAccount)} />
            {tx.sourceAccount === account && <span className="ml-2 text-fg-muted">(you)</span>}
          </Row>
          <Row label="Fee">
            <AmountDisplay amount={tx.fee} asset="XLM" />
            {tx.feeAccount !== tx.sourceAccount && (
              <span className="ml-2 text-fg-muted">paid by {truncateAddress(tx.feeAccount)}</span>
            )}
          </Row>
          <Row label="Max fee">
            <AmountDisplay amount={tx.maxFee} asset="XLM" />
          </Row>
          <Row label="Memo">
            {tx.memo ? (
              <>
                <span className="mr-2 text-fg-muted">{MEMO_TYPES[tx.memoType ?? ""] ?? tx.memoType}</span>
                {tx.memo}
              </>
            ) : (
              <span className="text-fg-muted">None</span>
            )}
          </Row>
          <Row label="Operations">{tx.operationCount}</Row>
        </dl>
      </CardBody>
    </Card>
  );
}

/** /activity/[hash]: one transaction with its summary and operations. */
export function TransactionDetailView({ hash }: { hash: string }) {
  const account = useCurrentAccount();
  const valid = isTransactionHash(hash);
  const tx = useTransaction(valid ? hash : null, account);
  const explorer = tx.data?.explorerUrl ?? (valid ? txUrl(hash.toLowerCase()) : null);
  const waiting = isTransactionNotFound(tx.error) && tx.errorUpdateCount < PENDING_MAX_POLLS;

  const header = (
    <PageHeader
      title="Transaction"
      description={valid ? <span className="font-mono">{truncateAddress(hash.toLowerCase(), 8, 8)}</span> : undefined}
      actions={
        <>
          <Link href="/activity" className="text-sm font-medium text-primary hover:underline">
            Back to activity
          </Link>
          {explorer && (
            <a
              href={explorer}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              View on explorer <ExternalLinkIcon className="h-4 w-4" />
            </a>
          )}
        </>
      }
    />
  );

  if (!valid) {
    return (
      <>
        {header}
        <EmptyState title="Invalid transaction hash" description="A transaction hash is 64 hexadecimal characters." />
      </>
    );
  }

  let body: ReactNode;
  if (tx.isPending) {
    body = (
      <div aria-busy="true" aria-label="Loading transaction" className="flex flex-col gap-4">
        <Skeleton className="h-80 rounded-[var(--radius-card)]" />
      </div>
    );
  } else if (waiting) {
    body = (
      <EmptyState
        icon={<Spinner label={null} />}
        title="Waiting for the network"
        description="This transaction isn't in a ledger yet. This page updates automatically once it is."
      />
    );
  } else if (tx.isError) {
    body = isTransactionNotFound(tx.error) ? (
      <EmptyState title="Transaction not found" description="It may have expired before reaching the network, or the hash is wrong." />
    ) : (
      <EmptyState
        title="Couldn't load this transaction"
        description={describeError(tx.error)}
        action={<Button onClick={() => void tx.refetch()}>Try again</Button>}
      />
    );
  } else {
    body = (
      <>
        <Summary tx={tx.data} account={account} />
        <OperationList operations={tx.data.operations} />
        <Signatures hash={tx.data.hash} />
      </>
    );
  }

  return (
    <>
      {header}
      <div className="flex flex-col gap-4">{body}</div>
    </>
  );
}
