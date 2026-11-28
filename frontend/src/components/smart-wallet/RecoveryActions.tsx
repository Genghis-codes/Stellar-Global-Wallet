"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import type { PreparedInvocation, RecoveryState } from "@/lib/api/endpoints/contract";
import type { RecoveryPermissions } from "@/lib/contract/recovery";
import { isAccountId } from "@/lib/stellar/address";
import { useContractTx } from "@/hooks/useContractTx";
import { phaseLabel, useTxErrorToast } from "@/hooks/useSignAndSubmit";

export interface RecoveryActionsProps {
  account: string;
  state: RecoveryState;
  permissions: RecoveryPermissions;
}

type ActionId = "initiate" | "approve" | "revoke" | "execute" | "cancel";

/** Recovery actions the signed-in account may take right now. */
export function RecoveryActions({ account, state, permissions }: RecoveryActionsProps) {
  const [newAdmin, setNewAdmin] = useState("");
  const [running, setRunning] = useState<ActionId | null>(null);
  const toast = useToast();
  const toastError = useTxErrorToast();
  const { execute, phase } = useContractTx();

  async function run(id: ActionId, build: () => Promise<PreparedInvocation>, success: string) {
    setRunning(id);
    try {
      await execute(build);
      toast.show({ title: success, tone: "success" });
      if (id === "initiate") setNewAdmin("");
    } catch (error) {
      toastError(error, "Recovery action failed");
    } finally {
      setRunning(null);
    }
  }

  const label = (id: ActionId, idle: string) => (running === id ? phaseLabel(phase, idle) : idle);
  const newAdminError = newAdmin && !isAccountId(newAdmin.trim()) ? "Enter a valid G… account id." : undefined;
  const roles = [permissions.isAdmin && "admin", permissions.isGuardian && "guardian"].filter(Boolean);

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-fg-muted">
        {roles.length > 0 ? `You are the ${roles.join(" and ")} of this wallet.` : "You are neither the admin nor a guardian."}
      </p>

      {permissions.canInitiate && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (newAdmin && !newAdminError) {
              void run("initiate", () => api.contract.buildInitiateRecovery(account, newAdmin.trim()), "Recovery started");
            }
          }}
        >
          <Input
            label="New admin account"
            placeholder="G…"
            value={newAdmin}
            onChange={(event) => setNewAdmin(event.target.value)}
            error={newAdminError}
            hint="The key that will control the wallet once recovery completes. Your approval counts first."
            spellCheck={false}
            autoComplete="off"
          />
          <Button type="submit" loading={running === "initiate"} disabled={!newAdmin || Boolean(newAdminError) || running !== null}>
            {label("initiate", "Start recovery")}
          </Button>
        </form>
      )}

      {permissions.canApprove && (
        <Button
          loading={running === "approve"}
          disabled={running !== null}
          onClick={() => void run("approve", () => api.contract.buildApproveRecovery(account), "Approval recorded")}
        >
          {label("approve", "Approve recovery")}
        </Button>
      )}

      {permissions.canRevoke && (
        <div className="flex flex-col gap-2">
          <p className="text-fg-muted">
            You approved this recovery.
            {state.proposal?.quorumReached && " Withdrawing below the threshold stops the timelock."}
          </p>
          <Button
            variant="secondary"
            loading={running === "revoke"}
            disabled={running !== null}
            onClick={() =>
              void run("revoke", () => api.contract.buildRevokeRecoveryApproval(account), "Approval withdrawn")
            }
          >
            {label("revoke", "Withdraw approval")}
          </Button>
        </div>
      )}
      {permissions.canExecute && (
        <div className="flex flex-col gap-2">
          <p className="text-fg-muted">The timelock has passed. Anyone can now complete the recovery (you pay the fee).</p>
          <Button
            loading={running === "execute"}
            disabled={running !== null}
            onClick={() => void run("execute", () => api.contract.buildExecuteRecovery(account), "Recovery completed")}
          >
            {label("execute", "Execute recovery")}
          </Button>
        </div>
      )}

      {permissions.isAdmin && state.proposal && (
        <div className="flex flex-col gap-2">
          <p className="text-fg-muted">If you didn&apos;t lose your key, cancel this recovery.</p>
          <Button
            variant="danger"
            loading={running === "cancel"}
            disabled={!permissions.canCancel || running !== null}
            onClick={() => void run("cancel", () => api.contract.buildCancelRecovery(account), "Recovery cancelled")}
          >
            {label("cancel", "Cancel recovery")}
          </Button>
          {permissions.cancelBlockedReason && <p className="text-xs text-danger">{permissions.cancelBlockedReason}</p>}
        </div>
      )}
    </div>
  );
}
