"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { MultisigInfo } from "@/lib/api/endpoints/account";
import { parseWeight, simulateSignerChange } from "@/lib/multisig/thresholds";
import { isAccountId } from "@/lib/stellar/address";
import { phaseLabel, useTxErrorToast } from "@/hooks/useSignAndSubmit";
import { ChangeReview, canProceed } from "./ChangeReview";
import { outcomeToast, useSignerChange } from "./useSignerChange";

export interface AddSignerModalProps {
  open: boolean;
  onClose: () => void;
  info: MultisigInfo;
  account: string;
}

export function AddSignerModal({ open, onClose, info, account }: AddSignerModalProps) {
  const [key, setKey] = useState("");
  const [weightText, setWeightText] = useState("1");
  const [acknowledged, setAcknowledged] = useState(false);
  const toast = useToast();
  const toastError = useTxErrorToast();
  const { apply, phase, busy } = useSignerChange(info, account);

  const keyError = key && !isAccountId(key.trim()) ? "Enter a valid G… account id." : undefined;
  const existing = info.signers.find((signer) => signer.key === key.trim());
  const weight = parseWeight(weightText);
  const weightError = "error" in weight ? weight.error : weight.value === 0 ? "Weight must be at least 1." : undefined;

  const review = useMemo(() => {
    if (!key || keyError || "error" in weight || weight.value === 0) return null;
    return simulateSignerChange(info, { addSigners: [{ key: key.trim(), weight: weight.value }] });
  }, [info, key, keyError, weight]);

  function close() {
    setKey("");
    setWeightText("1");
    setAcknowledged(false);
    onClose();
  }

  async function submit() {
    if (!review || "error" in weight) return;
    try {
      const outcome = await apply({ addSigners: [{ key: key.trim(), weight: weight.value }] });
      toast.show(outcomeToast(outcome));
      close();
    } catch (error) {
      toastError(error, "Couldn't add the signer");
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      dismissible={!busy}
      title={existing ? "Change signer weight" : "Add signer"}
      description="Signers are other Stellar keys that can approve transactions for this account."
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            loading={busy}
            disabled={!review || !canProceed(review, acknowledged)}
          >
            {phaseLabel(phase, existing ? "Update signer" : "Add signer")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          label="Signer account"
          placeholder="G…"
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
            setAcknowledged(false);
          }}
          error={keyError}
          autoComplete="off"
          spellCheck={false}
          hint={existing ? `Already a signer with weight ${existing.weight}.` : undefined}
        />
        <Input
          label="Weight"
          inputMode="numeric"
          value={weightText}
          onChange={(event) => {
            setWeightText(event.target.value);
            setAcknowledged(false);
          }}
          error={weightText ? weightError : undefined}
          hint={`Thresholds: low ${info.thresholds.low}, medium ${info.thresholds.medium}, high ${info.thresholds.high}.`}
        />
        {review && <ChangeReview result={review} acknowledged={acknowledged} onAcknowledge={setAcknowledged} />}
      </form>
    </Modal>
  );
}
