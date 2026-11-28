"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { describeError } from "@/lib/api/errors";
import { summarizeTransaction } from "@/lib/multisig/pendingTx";
import { networkPassphrase } from "@/lib/stellar/network";
import { useSharePendingTx } from "@/hooks/usePendingTxs";

export interface ShareTxModalProps {
  open: boolean;
  onClose: () => void;
  account: string;
}

/** Share a (partially) signed transaction built elsewhere so the other signers can co-sign it. */
export function ShareTxModal({ open, onClose, account }: ShareTxModalProps) {
  const [xdr, setXdr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const share = useSharePendingTx(account);
  const toast = useToast();
  const text = xdr.trim();
  const summary = text ? summarizeTransaction(text, networkPassphrase()) : null;

  function close() {
    setXdr("");
    setError(null);
    onClose();
  }

  async function submit() {
    setError(null);
    try {
      const created = await share.mutateAsync(text);
      toast.show({
        title: created.status === "ready" ? "Shared: already fully signed" : "Shared for co-signing",
        tone: "success",
      });
      close();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      dismissible={!share.isPending}
      title="Share a transaction"
      description="Paste a signed transaction envelope (XDR) for an account you sign for."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={share.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={share.isPending} disabled={!summary}>
            Share
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label htmlFor="share-xdr" className="text-sm font-medium text-fg">
          Transaction XDR
        </label>
        <textarea
          id="share-xdr"
          rows={5}
          value={xdr}
          onChange={(event) => setXdr(event.target.value)}
          spellCheck={false}
          aria-invalid={text && !summary ? true : undefined}
          aria-describedby="share-xdr-help"
          className="w-full rounded-lg border border-border bg-surface p-3 font-mono text-xs text-fg outline-none focus:ring-2 focus:ring-ring"
        />
        <p id="share-xdr-help" className={text && !summary ? "text-xs text-danger" : "text-xs text-fg-muted"}>
          {text && !summary
            ? "That isn't a transaction for this network."
            : summary
              ? `${summary.operations.length} operation${summary.operations.length === 1 ? "" : "s"} · ${summary.signatureCount} signature${summary.signatureCount === 1 ? "" : "s"}`
              : "Fee-bump envelopes can't be shared; share the inner transaction."}
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
