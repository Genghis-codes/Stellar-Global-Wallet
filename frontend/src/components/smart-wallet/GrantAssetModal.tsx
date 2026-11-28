"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import type { ContractAsset } from "@/lib/api/endpoints/contract";
import { isAccountId } from "@/lib/stellar/address";
import { useContractTx } from "@/hooks/useContractTx";
import { phaseLabel, useTxErrorToast } from "@/hooks/useSignAndSubmit";

export interface GrantAssetModalProps {
  open: boolean;
  onClose: () => void;
  account: string;
  existing: ContractAsset[];
}

/** Parse the form into a contract asset, or a field error. */
export function parseAsset(code: string, issuer: string): ContractAsset | { field: "code" | "issuer"; error: string } {
  const trimmed = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,12}$/.test(trimmed)) return { field: "code", error: "Use 1–12 letters or digits." };
  if (trimmed === "XLM") return { code: "XLM", issuer: null };
  if (!isAccountId(issuer.trim())) return { field: "issuer", error: "Enter the issuer's G… account id." };
  return { code: trimmed, issuer: issuer.trim() };
}

/** Add an asset to the wallet's whitelist so it can be sent (and limited). */
export function GrantAssetModal({ open, onClose, account, existing }: GrantAssetModalProps) {
  const [code, setCode] = useState("");
  const [issuer, setIssuer] = useState("");
  const toast = useToast();
  const toastError = useTxErrorToast();
  const { execute, phase, busy } = useContractTx();

  const parsed = code ? parseAsset(code, issuer) : null;
  const asset = parsed && !("error" in parsed) ? parsed : null;
  const duplicate = asset && existing.some((item) => item.code === asset.code);
  const codeError = parsed && "error" in parsed && parsed.field === "code" ? parsed.error : duplicate ? "Already allowed." : undefined;
  const issuerError = parsed && "error" in parsed && parsed.field === "issuer" && issuer ? parsed.error : undefined;

  function close() {
    setCode("");
    setIssuer("");
    onClose();
  }

  async function submit() {
    if (!asset || duplicate) return;
    try {
      await execute(() => api.contract.buildAddAsset(account, asset));
      toast.show({ title: `${asset.code} allowed`, tone: "success" });
      close();
    } catch (error) {
      toastError(error, "Couldn't allow the asset");
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      dismissible={!busy}
      title="Allow an asset"
      description="The smart wallet only sends assets on its allow list."
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!asset || Boolean(duplicate)}>
            {phaseLabel(phase, "Allow asset")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input label="Asset code" placeholder="USDC" value={code} onChange={(e) => setCode(e.target.value)} error={codeError} />
        {code.trim().toUpperCase() !== "XLM" && (
          <Input
            label="Issuer"
            placeholder="G…"
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            error={issuerError}
            spellCheck={false}
            autoComplete="off"
          />
        )}
      </div>
    </Modal>
  );
}
