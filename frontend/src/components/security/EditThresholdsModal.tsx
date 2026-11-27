"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { MultisigInfo } from "@/lib/api/endpoints/account";
import type { SetOptionsInput } from "@/lib/api/endpoints/multisig";
import { THRESHOLD_LEVELS, maxSafeThreshold, parseWeight, simulateSignerChange, type Thresholds } from "@/lib/multisig/thresholds";
import { phaseLabel, useTxErrorToast } from "@/hooks/useSignAndSubmit";
import { ChangeReview, canProceed } from "./ChangeReview";
import { outcomeToast, useSignerChange } from "./useSignerChange";

export interface EditThresholdsModalProps {
  open: boolean;
  onClose: () => void;
  info: MultisigInfo;
  account: string;
}

type Field = keyof Thresholds | "master";

const LABELS: Record<Field, string> = {
  low: "Low threshold",
  medium: "Medium threshold",
  high: "High threshold",
  master: "Master key weight",
};

function initialValues(info: MultisigInfo): Record<Field, string> {
  const master = info.signers.find((signer) => signer.isMaster)?.weight ?? 0;
  return {
    low: String(info.thresholds.low),
    medium: String(info.thresholds.medium),
    high: String(info.thresholds.high),
    master: String(master),
  };
}

export function EditThresholdsModal({ open, onClose, info, account }: EditThresholdsModalProps) {
  const [values, setValues] = useState(() => initialValues(info));
  const [acknowledged, setAcknowledged] = useState(false);
  const toast = useToast();
  const toastError = useTxErrorToast();
  const { apply, phase, busy } = useSignerChange(info, account);

  const parsed = useMemo(() => {
    const entries = (Object.keys(values) as Field[]).map((field) => [field, parseWeight(values[field])] as const);
    return Object.fromEntries(entries) as Record<Field, ReturnType<typeof parseWeight>>;
  }, [values]);
  const valid = Object.values(parsed).every((result) => "value" in result);

  const change = useMemo((): Omit<SetOptionsInput, "sourcePublicKey"> | null => {
    if (!valid) return null;
    const value = (field: Field) => (parsed[field] as { value: number }).value;
    const initial = initialValues(info);
    const result: Omit<SetOptionsInput, "sourcePublicKey"> = {};
    if (values.low !== initial.low) result.lowThreshold = value("low");
    if (values.medium !== initial.medium) result.mediumThreshold = value("medium");
    if (values.high !== initial.high) result.highThreshold = value("high");
    if (values.master !== initial.master) result.masterWeight = value("master");
    return Object.keys(result).length > 0 ? result : null;
  }, [info, parsed, valid, values]);

  const review = useMemo(
    () =>
      change &&
      simulateSignerChange(info, {
        masterWeight: change.masterWeight,
        thresholds: { low: change.lowThreshold, medium: change.mediumThreshold, high: change.highThreshold },
      }),
    [change, info],
  );

  function close() {
    setValues(initialValues(info));
    setAcknowledged(false);
    onClose();
  }

  async function submit() {
    if (!change) return;
    try {
      toast.show(outcomeToast(await apply(change)));
      close();
    } catch (error) {
      toastError(error, "Couldn't change the thresholds");
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      dismissible={!busy}
      title="Edit thresholds"
      description={`Each threshold must stay at or below the combined signer weight (now ${maxSafeThreshold(info.signers)}).`}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!review || !canProceed(review, acknowledged)}>
            {phaseLabel(phase, "Save thresholds")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {([...THRESHOLD_LEVELS, "master"] as Field[]).map((field) => {
            const result = parsed[field];
            return (
              <Input
                key={field}
                label={LABELS[field]}
                inputMode="numeric"
                value={values[field]}
                error={"error" in result ? result.error : undefined}
                onChange={(event) => {
                  setValues((current) => ({ ...current, [field]: event.target.value }));
                  setAcknowledged(false);
                }}
              />
            );
          })}
        </div>
        {review && <ChangeReview result={review} acknowledged={acknowledged} onAcknowledge={setAcknowledged} />}
      </div>
    </Modal>
  );
}
