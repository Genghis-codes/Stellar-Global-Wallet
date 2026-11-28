"use client";

import { useState, type ReactNode } from "react";
import { AlertIcon } from "@/components/icons";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { Button } from "@/components/ui/Button";
import { Countdown } from "@/components/ui/Countdown";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { useCurrentAccount } from "@/hooks/useAccount";
import { useContractTx } from "@/hooks/useContractTx";
import { useAppConfig } from "@/hooks/useServerConfig";
import { phaseLabel, useTxErrorToast } from "@/hooks/useSignAndSubmit";
import { useContractAdmin, useContractStatus } from "@/hooks/useSmartWallet";

function Banner({ tone, children }: { tone: "warning" | "danger" | "info"; children: ReactNode }) {
  const tones = {
    warning: "border-warning bg-warning-soft text-warning",
    danger: "border-danger bg-danger-soft text-danger",
    info: "border-info bg-info-soft text-info",
  };
  return (
    <div role="status" className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm ${tones[tone]}`}>
      <AlertIcon className="h-4 w-4 shrink-0" />
      {children}
    </div>
  );
}

/**
 * Contract-wide notices: a queued upgrade (from GET /config), a pending admin
 * transfer (GET /contract/admin) with accept/cancel for the parties, and
 * paused sends.
 */
export function ContractBanners() {
  const account = useCurrentAccount();
  const config = useAppConfig();
  const admin = useContractAdmin();
  const status = useContractStatus();
  const toast = useToast();
  const toastError = useTxErrorToast();
  const { execute, phase, busy } = useContractTx();
  const [action, setAction] = useState<"accept" | "cancel" | null>(null);

  const upgrade = config.data?.contracts.globeWallet.pendingUpgrade;
  const pendingAdmin = admin.data?.pendingAdmin;

  async function run(kind: "accept" | "cancel") {
    setAction(kind);
    try {
      await execute(() =>
        kind === "accept" ? api.contract.buildAcceptAdmin(account) : api.contract.buildCancelAdminTransfer(account),
      );
      toast.show({ title: kind === "accept" ? "You are now the admin" : "Admin transfer cancelled", tone: "success" });
    } catch (error) {
      toastError(error, "Admin transfer failed");
    } finally {
      setAction(null);
    }
  }

  if (!config.data?.features.contract) return null;
  if (!upgrade && !pendingAdmin && !status.data?.sendsPaused) return null;

  return (
    <div className="mb-4 flex flex-col gap-2">
      {status.data?.sendsPaused && (
        <Banner tone="danger">
          <span>Sends from the smart wallet are paused by the contract&apos;s emergency switch.</span>
        </Banner>
      )}
      {upgrade && (
        <Banner tone="warning">
          <span>
            A contract upgrade is queued (WASM <code className="break-all">{upgrade.wasmHash.slice(0, 12)}…</code>)
            {upgrade.executableAt ? (
              <>
                {" "}
                and can run in <Countdown target={upgrade.executableAt} doneLabel="any moment" />
              </>
            ) : (
              ` at ledger ${upgrade.readyAtLedger}`
            )}
            .
          </span>
        </Banner>
      )}
      {pendingAdmin && admin.data && (
        <Banner tone="info">
          <span className="flex flex-wrap items-center gap-1">
            Admin transfer pending to <AddressDisplay address={pendingAdmin} />.
          </span>
          {pendingAdmin === account && (
            <Button size="sm" className="ml-auto" loading={action === "accept"} disabled={busy} onClick={() => void run("accept")}>
              {action === "accept" ? phaseLabel(phase, "Accept admin role") : "Accept admin role"}
            </Button>
          )}
          {admin.data.admin === account && (
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              loading={action === "cancel"}
              disabled={busy}
              onClick={() => void run("cancel")}
            >
              {action === "cancel" ? phaseLabel(phase, "Cancel transfer") : "Cancel transfer"}
            </Button>
          )}
        </Banner>
      )}
    </div>
  );
}
