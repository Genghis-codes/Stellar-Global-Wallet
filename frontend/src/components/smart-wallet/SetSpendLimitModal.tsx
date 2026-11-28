"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import type { SpendAllowance } from "@/lib/api/endpoints/contract";
import { SPEND_LIMIT_INCREASE_DELAY_MS, parseSpendLimitInput, type PendingSpendLimit } from "@/lib/contract/spendLimit";
import { fromStroops } from "@/lib/stellar/amount";
import { useContractTx } from "@/hooks/useContractTx";
import { phaseLabel, useTxErrorToast } from "@/hooks/useSignAndSubmit";

export interface SetSpendLimitModalProps {
  /** Asset being edited; the modal is open while set. */
  allowance: SpendAllowance | null;
  account: string;
  onClose: () => void;
  /** Called when an increase was queued (to start its countdown). */
  onQueued: (pending: PendingSpendLimit) => void;
}

export function SetSpendLimitModal({ allowance, account, onClose, onQueued }: SetSpendLimitModalProps) {
  const [text, setText] = useState("");
  const [unlimited, setUnlimited] = useState(false);
  const toast = useToast();
  const toastError = useTxErrorToast();
  const { execute, phase, busy } = useContractTx();

  const parsed = allowance && (text || unlimited) ? parseSpendLimitInput(text, allowance, unlimited) : null;
  const error = parsed && "error" in parsed ? parsed.error : undefined;
  const input = parsed && !("error" in parsed) ? parsed : null;

  function close() {
    setText("");
    setUnlimited(false);
    onClose();
  }

  async function submit() {
    if (!allowance || !input || input.change === "noop") return;
    try {
      const result = await execute(() => api.contract.buildSetSpendLimit(account, allowance.assetCode, input.limit));
      if (input.change === "increase") {
        onQueued({
          assetCode: allowance.assetCode,
          limit: input.stroops.toString(),
          previousLimit: allowance.limit,
          effectiveAt: new Date(Date.now() + SPEND_LIMIT_INCREASE_DELAY_MS).toISOString(),
          hash: result.hash,
        });
        toast.show({ title: "Increase queued", description: "The new limit takes effect in 24 hours.", tone: "info" });
      } else {
        toast.show({ title: "Spend limit lowered", tone: "success" });
      }
      close();
    } catch (err) {
      toastError(err, "Couldn't set the spend limit");
    }
  }

  return (
    <Modal
      open={allowance !== null}
      onClose={close}
      dismissible={!busy}
      title={allowance ? `${allowance.assetCode} spend limit` : "Spend limit"}
      description={
        allowance &&
        (allowance.unlimited ? "Currently unlimited." : `Currently ${fromStroops(allowance.limit)} ${allowance.assetCode} per 24 hours.`)
      }
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!input || input.change === "noop"}>
            {phaseLabel(phase, input?.change === "increase" ? "Queue increase" : "Set limit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Limit per 24 hours"
          inputMode="decimal"
          placeholder="0.00"
          value={text}
          disabled={unlimited}
          onChange={(event) => setText(event.target.value)}
          error={error}
          trailing={allowance?.assetCode}
        />
        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={unlimited} onChange={(event) => setUnlimited(event.target.checked)} />
          Remove the limit
        </label>
        {input?.change === "increase" && (
          <p role="status" className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
            This raises the limit, so it takes effect after a 24-hour delay. Until then the current limit still applies,
            and you or a guardian can cancel it.
          </p>
        )}
        {input?.change === "decrease" && (
          <p role="status" className="rounded-lg bg-success-soft p-3 text-sm text-success">
            Lowering a limit applies immediately.
          </p>
        )}
        {input?.change === "noop" && <p className="text-sm text-fg-muted">That&apos;s the current limit.</p>}
      </div>
    </Modal>
  );
}
