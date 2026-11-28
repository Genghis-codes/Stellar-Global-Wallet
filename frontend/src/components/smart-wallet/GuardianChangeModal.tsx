"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { api } from "@/lib/api";
import type { RecoveryState } from "@/lib/api/endpoints/contract";
import { checkAddGuardian, checkRemoveGuardian } from "@/lib/contract/guardians";
import { formatDuration, ledgersToMs } from "@/lib/countdown";
import { isAccountId } from "@/lib/stellar/address";
import { useContractTx } from "@/hooks/useContractTx";
import { phaseLabel, useTxErrorToast } from "@/hooks/useSignAndSubmit";

export type GuardianChange = { kind: "add" } | { kind: "remove"; guardian: string };

export interface GuardianChangeModalProps {
  change: GuardianChange | null;
  state: RecoveryState;
  /** The contract admin (the signed-in account). */
  admin: string;
  onClose: () => void;
}

/** Add or remove a guardian (admin only), with the contract's freeze and timelock rules. */
export function GuardianChangeModal({ change, state, admin, onClose }: GuardianChangeModalProps) {
  const [input, setInput] = useState("");
  const toast = useToast();
  const toastError = useTxErrorToast();
  const { execute, phase, busy } = useContractTx();

  const guardian = change?.kind === "remove" ? change.guardian : input.trim();
  const formatError = change?.kind === "add" && input && !isAccountId(guardian) ? "Enter a valid G… account id." : undefined;
  const check =
    change && guardian && !formatError
      ? change.kind === "add"
        ? checkAddGuardian(state, guardian)
        : checkRemoveGuardian(state, guardian)
      : null;
  const delay = state.config ? formatDuration(ledgersToMs(state.config.delayInLedgers)) : null;

  function close() {
    setInput("");
    onClose();
  }

  async function submit() {
    if (!change || !check?.ok) return;
    try {
      await execute(() =>
        change.kind === "add" ? api.contract.buildAddGuardian(admin, guardian) : api.contract.buildRemoveGuardian(admin, guardian),
      );
      toast.show(
        check.queued
          ? { title: "Change queued", description: `It can be applied after about ${delay}.`, tone: "info" }
          : { title: change.kind === "add" ? "Guardian added" : "Guardian removed", tone: "success" },
      );
      close();
    } catch (error) {
      toastError(error, change.kind === "add" ? "Couldn't add the guardian" : "Couldn't remove the guardian");
    }
  }

  const label = change?.kind === "remove" ? "Remove guardian" : "Add guardian";

  return (
    <Modal
      open={change !== null}
      onClose={close}
      dismissible={!busy}
      title={label}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={change?.kind === "remove" ? "danger" : "primary"}
            onClick={() => void submit()}
            loading={busy}
            disabled={!check?.ok}
          >
            {phaseLabel(phase, label)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {change?.kind === "add" ? (
          <Input
            label="Guardian account"
            placeholder="G…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            error={formatError ?? (check && !check.ok ? check.reason : undefined)}
            spellCheck={false}
            autoComplete="off"
          />
        ) : (
          change && (
            <>
              <p>
                Remove <AddressDisplay address={change.guardian} /> as a guardian?
              </p>
              {check && !check.ok && (
                <p role="alert" className="text-sm text-danger">
                  {check.reason}
                </p>
              )}
            </>
          )
        )}
        {check?.ok && check.queued && (
          <p role="status" className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
            Recovery is configured, so this change is queued for about {delay} before it can be applied. This gives
            guardians time to react if your key was stolen.
          </p>
        )}
      </div>
    </Modal>
  );
}
