"use client";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { isUserRejection } from "@/hooks/useSignAndSubmit";
import { useSwap } from "@/hooks/useSwap";
import { isSubmitPending } from "@/lib/api/endpoints/wallet";
import { describeError } from "@/lib/api/errors";
import { formatAmount } from "@/lib/format";
import { txUrl } from "@/lib/stellar/explorer";
import { maxSent, minReceived } from "@/lib/swap/quote";
import { QuoteSummary } from "./QuoteSummary";
import type { SwapDraft } from "./SwapForm";

export interface SwapReviewModalProps {
  draft: SwapDraft | null;
  onClose: () => void;
  /** Called after a successful (or accepted-but-pending) submission. */
  onDone: () => void;
}

/** Final confirmation: what leaves, what arrives (with its slippage bound), then sign and submit. */
export function SwapReviewModal({ draft, onClose, onDone }: SwapReviewModalProps) {
  const swap = useSwap();
  const toast = useToast();

  if (!draft) return null;
  const { mode, from, to, amount, slippageBps, quote } = draft;
  const pay = mode === "send" ? amount : quote.source_amount;
  const receive = mode === "send" ? quote.destination_amount : amount;
  const result = swap.data;

  function close() {
    if (swap.isPending) return;
    swap.reset();
    onClose();
  }

  async function confirm() {
    if (!draft) return;
    try {
      const output = await swap.mutateAsync({
        mode,
        from: from.id,
        to: to.id,
        amount,
        slippageBps,
        quote,
      });
      if (isSubmitPending(output.result)) {
        toast.show({ tone: "info", title: "Swap submitted", description: "The network is still confirming it." });
      } else {
        toast.show({ tone: "success", title: "Swap complete", description: `Received ${to.asset.code}.` });
      }
      onDone();
    } catch (error) {
      if (!isUserRejection(error)) {
        toast.show({ tone: "danger", title: "Swap failed", description: describeError(error) });
      }
    }
  }

  return (
    <Modal
      open
      onClose={close}
      dismissible={!swap.isPending}
      title={result ? "Swap sent" : "Review swap"}
      description={result ? undefined : "Prices can move before the network executes the swap."}
      footer={
        result ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={swap.isPending}>
              Back
            </Button>
            <Button onClick={() => void confirm()} loading={swap.isPending}>
              {swap.isPending ? "Confirm in wallet…" : "Confirm swap"}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <p>
          Transaction{" "}
          <a href={txUrl(result.result.hash)} target="_blank" rel="noopener noreferrer" className="font-mono text-primary hover:underline">
            {result.result.hash.slice(0, 12)}…
          </a>{" "}
          {isSubmitPending(result.result) ? "was submitted and is awaiting confirmation." : "was confirmed."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-fg-muted">You pay {mode === "receive" && "(at most)"}</p>
              <p className="mt-1 text-lg font-semibold text-fg">
                {formatAmount(mode === "send" ? pay : maxSent(pay, slippageBps))} {from.asset.code}
              </p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-fg-muted">You receive {mode === "send" && "(at least)"}</p>
              <p className="mt-1 text-lg font-semibold text-fg">
                {formatAmount(mode === "send" ? minReceived(receive, slippageBps) : receive)} {to.asset.code}
              </p>
            </div>
          </div>
          <QuoteSummary quote={quote} mode={mode} slippageBps={slippageBps} fromCode={from.asset.code} toCode={to.asset.code} />
        </div>
      )}
    </Modal>
  );
}
