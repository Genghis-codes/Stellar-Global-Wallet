"use client";

import { useMemo, useState } from "react";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { MultisigInfo } from "@/lib/api/endpoints/account";
import { simulateSignerChange } from "@/lib/multisig/thresholds";
import { phaseLabel, useTxErrorToast } from "@/hooks/useSignAndSubmit";
import { ChangeReview, canProceed } from "./ChangeReview";
import { outcomeToast, useSignerChange } from "./useSignerChange";

export interface RemoveSignerModalProps {
  /** Signer to remove; the modal is open while set. */
  signer: string | null;
  onClose: () => void;
  info: MultisigInfo;
  account: string;
}

export function RemoveSignerModal({ signer, onClose, info, account }: RemoveSignerModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const toast = useToast();
  const toastError = useTxErrorToast();
  const { apply, phase, busy } = useSignerChange(info, account);

  const review = useMemo(() => {
    if (!signer) return null;
    const result = simulateSignerChange(info, { removeSigners: [signer] });
    if (signer === account && result.problems.length === 0) {
      result.warnings.unshift("You are removing your own key: you won't be able to sign for this account afterwards.");
    }
    return result;
  }, [info, signer, account]);

  function close() {
    setAcknowledged(false);
    onClose();
  }

  async function submit() {
    if (!signer) return;
    try {
      toast.show(outcomeToast(await apply({ removeSigners: [signer] })));
      close();
    } catch (error) {
      toastError(error, "Couldn't remove the signer");
    }
  }

  return (
    <Modal
      open={signer !== null}
      onClose={close}
      dismissible={!busy}
      title="Remove signer"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void submit()}
            loading={busy}
            disabled={!review || !canProceed(review, acknowledged)}
          >
            {phaseLabel(phase, "Remove signer")}
          </Button>
        </>
      }
    >
      {signer && review && (
        <div className="flex flex-col gap-3">
          <p>
            Remove <AddressDisplay address={signer} /> from the signers? Combined weight would drop to{" "}
            <strong>{review.totalWeight}</strong>.
          </p>
          <ChangeReview result={review} acknowledged={acknowledged} onAcknowledge={setAcknowledged} />
        </div>
      )}
    </Modal>
  );
}
