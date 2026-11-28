"use client";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { useContractTx } from "@/hooks/useContractTx";
import { phaseLabel, useTxErrorToast } from "@/hooks/useSignAndSubmit";

export interface RevokeAssetModalProps {
  /** Asset code to revoke; the modal is open while set. */
  assetCode: string | null;
  account: string;
  onClose: () => void;
}

/** Remove an asset from the wallet's allow list. */
export function RevokeAssetModal({ assetCode, account, onClose }: RevokeAssetModalProps) {
  const toast = useToast();
  const toastError = useTxErrorToast();
  const { execute, phase, busy } = useContractTx();

  async function submit() {
    if (!assetCode) return;
    try {
      await execute(() => api.contract.buildRemoveAsset(account, assetCode));
      toast.show({ title: `${assetCode} revoked`, tone: "success" });
      onClose();
    } catch (error) {
      toastError(error, "Couldn't revoke the asset");
    }
  }

  return (
    <Modal
      open={assetCode !== null}
      onClose={onClose}
      dismissible={!busy}
      title={`Revoke ${assetCode ?? ""}?`}
      description="The smart wallet will refuse to send this asset until you allow it again. Balances aren't affected."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep
          </Button>
          <Button variant="danger" onClick={() => void submit()} loading={busy}>
            {phaseLabel(phase, "Revoke")}
          </Button>
        </>
      }
    />
  );
}
