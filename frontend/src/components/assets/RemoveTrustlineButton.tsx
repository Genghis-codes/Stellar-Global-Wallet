"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useAccountTransaction } from "@/hooks/useAccountTransaction";
import { phaseLabel, useTxErrorToast } from "@/hooks/useSignAndSubmit";
import { api } from "@/lib/api";
import type { HorizonBalanceLine } from "@/lib/api/endpoints/account";

const isZero = (amount: string | undefined) => !amount || /^0*(\.0*)?$/.test(amount);

/** A trustline can be removed only when nothing is held or reserved in offers. */
export function canRemoveTrustline(line: HorizonBalanceLine): boolean {
  return (
    (line.asset_type === "credit_alphanum4" || line.asset_type === "credit_alphanum12") &&
    isZero(line.balance) &&
    isZero(line.buying_liabilities) &&
    isZero(line.selling_liabilities)
  );
}

export interface RemoveTrustlineButtonProps {
  account: string;
  code: string;
  issuer: string;
  onRemoved?: () => void;
}

/** Remove a zero-balance trustline (limit "0"), freeing its 0.5 XLM reserve. */
export function RemoveTrustlineButton({ account, code, issuer, onRemoved }: RemoveTrustlineButtonProps) {
  const toast = useToast();
  const errorToast = useTxErrorToast();
  const [open, setOpen] = useState(false);
  const { execute, phase, busy } = useAccountTransaction(account);

  async function remove() {
    try {
      const outcome = await execute(() => api.wallet.buildTrustline({ account, asset: { code, issuer }, limit: "0" }));
      toast.show({ title: outcome.pending ? "Submitted, waiting for the network" : `${code} removed`, tone: "success" });
      setOpen(false);
      onRemoved?.();
    } catch (err) {
      errorToast(err, "Couldn't remove the asset");
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Remove ${code}`}>
        Remove
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!busy}
        size="sm"
        title={`Remove ${code}?`}
        description="This removes the trustline and returns its 0.5 XLM reserve. You won't be able to receive this asset until you add it again."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void remove()} loading={busy}>
              {phaseLabel(phase, "Remove trustline")}
            </Button>
          </>
        }
      />
    </>
  );
}
