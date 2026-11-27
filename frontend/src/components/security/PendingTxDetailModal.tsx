"use client";

import type { ReactNode } from "react";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import type { PendingTx } from "@/lib/api/endpoints/pendingTxs";
import { fromStroops } from "@/lib/stellar/amount";
import { networkPassphrase } from "@/lib/stellar/network";
import { PENDING_STATUS, summarizeTransaction } from "@/lib/multisig/pendingTx";

export interface PendingTxDetailModalProps {
  tx: PendingTx | null;
  onClose: () => void;
  /** Co-sign / submit / cancel buttons. */
  actions?: ReactNode;
  dismissible?: boolean;
}

/** What a pending transaction does and who has signed it. */
export function PendingTxDetailModal({ tx, onClose, actions, dismissible = true }: PendingTxDetailModalProps) {
  const summary = tx ? summarizeTransaction(tx.xdr, networkPassphrase()) : null;
  return (
    <Modal open={tx !== null} onClose={onClose} title="Transaction details" size="lg" footer={actions} dismissible={dismissible}>
      {tx && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={PENDING_STATUS[tx.status].tone}>{PENDING_STATUS[tx.status].label}</Badge>
            <span className="break-all font-mono text-xs text-fg-muted">{tx.hash}</span>
          </div>

          {summary ? (
            <section aria-label="Operations">
              <h3 className="mb-2 text-sm font-semibold text-fg">Operations</h3>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {summary.operations.map((op, index) => (
                  <li key={index} className="break-all">
                    {op.description}
                  </li>
                ))}
              </ol>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-fg-muted sm:grid-cols-3">
                <div>
                  <dt>Fee</dt>
                  <dd className="text-fg">{fromStroops(summary.fee)} XLM</dd>
                </div>
                <div>
                  <dt>Sequence</dt>
                  <dd className="text-fg">{summary.sequence}</dd>
                </div>
                {summary.memo && (
                  <div>
                    <dt>Memo</dt>
                    <dd className="break-all text-fg">{summary.memo}</dd>
                  </div>
                )}
              </dl>
            </section>
          ) : (
            <p className="text-sm text-warning">This transaction couldn&apos;t be decoded for the current network.</p>
          )}

          <section aria-label="Signatures">
            <h3 className="mb-2 text-sm font-semibold text-fg">
              Signatures · weight {tx.collectedWeight} of {tx.requiredWeight}
            </h3>
            {tx.collectedSigners.length === 0 ? (
              <p className="text-sm text-fg-muted">No valid signatures yet.</p>
            ) : (
              <ul className="space-y-1">
                {tx.collectedSigners.map((signer) => (
                  <li key={signer}>
                    <AddressDisplay address={signer} copyable />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
