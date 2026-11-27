"use client";

import { useCallback, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { describeError } from "@/lib/api/errors";
import { isSubmitPending, type SubmitPending, type SubmitResult } from "@/lib/api/endpoints/multisig";
import { networkPassphrase } from "@/lib/stellar/network";
import { isWalletError } from "@/lib/wallet/types";
import { useAuth } from "./useAuth";

export type TxPhase = "idle" | "building" | "signing" | "submitting";

/** What a backend build route returns: the envelope, plus an optional restore step (Soroban). */
export interface BuiltTransaction {
  xdr: string;
  networkPassphrase?: string;
  restore?: { transactionXdr: string };
}

export interface SignAndSubmitOptions {
  build: () => Promise<BuiltTransaction>;
  submit: (signedXdr: string) => Promise<SubmitResult | SubmitPending>;
}

/** Whether an error is the user closing the wallet prompt (no error toast for that). */
export function isUserRejection(error: unknown): boolean {
  return isWalletError(error) && error.code === "USER_REJECTED";
}

/**
 * build (server) → sign (wallet) → submit (server), with the current phase
 * for button labels. Soroban builds that need archived state restored first
 * sign and submit the restore transaction before the main one.
 */
export function useSignAndSubmit() {
  const { wallet, account } = useAuth();
  const [phase, setPhase] = useState<TxPhase>("idle");

  const sign = useCallback(
    (xdr: string, passphrase?: string) =>
      wallet.signTransaction(xdr, { networkPassphrase: passphrase ?? networkPassphrase(), address: account ?? undefined }),
    [wallet, account],
  );

  const run = useCallback(
    async ({ build, submit }: SignAndSubmitOptions): Promise<SubmitResult | SubmitPending> => {
      try {
        setPhase("building");
        const built = await build();
        if (built.restore) {
          setPhase("signing");
          const restoreSigned = await sign(built.restore.transactionXdr, built.networkPassphrase);
          setPhase("submitting");
          const restored = await submit(restoreSigned);
          if (!isSubmitPending(restored) && !restored.successful) {
            throw new Error("Restoring the contract's archived state failed.");
          }
        }
        setPhase("signing");
        const signed = await sign(built.xdr, built.networkPassphrase);
        setPhase("submitting");
        return await submit(signed);
      } finally {
        setPhase("idle");
      }
    },
    [sign],
  );

  return { run, sign, phase, busy: phase !== "idle" };
}

/** Toast a failed transaction flow, staying quiet when the user cancelled in the wallet. */
export function useTxErrorToast() {
  const toast = useToast();
  return useCallback(
    (error: unknown, title = "Transaction failed") => {
      if (isUserRejection(error)) return;
      toast.show({ title, description: describeError(error), tone: "danger" });
    },
    [toast],
  );
}

/** Button label for each phase of the flow. */
export function phaseLabel(phase: TxPhase, idle: string): string {
  switch (phase) {
    case "building":
      return "Preparing…";
    case "signing":
      return "Confirm in wallet…";
    case "submitting":
      return "Submitting…";
    default:
      return idle;
  }
}
