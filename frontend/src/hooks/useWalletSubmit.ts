"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SubmitResult } from "@/lib/api/endpoints/wallet";
import { queryKeys } from "@/lib/query/keys";
import { buildFeeBump, needsFeeBump } from "@/lib/stellar/feeBump";
import { networkPassphrase } from "@/lib/stellar/network";
import { WalletError } from "@/lib/wallet/types";
import { useCurrentAccount } from "./useAccount";
import { useAuth } from "./useAuth";

export interface WalletSubmitInput {
  /** Unsigned XDR from a /wallet/.../build route. */
  xdr: string;
  /** Passphrase the build route returned. */
  networkPassphrase: string;
  /**
   * Per-operation fee (stroops) the user picked. When it is more than the
   * build offers, the signed envelope is wrapped in a fee bump paid by the
   * same account (a second wallet signature).
   */
  perOperationFee?: string;
  /** Reused on retries so a resubmission replays instead of submitting twice. */
  idempotencyKey: string;
}

export interface WalletSubmitOutput {
  result: SubmitResult;
  /** The signed inner transaction (needed for a later fee bump). */
  signedXdr: string;
  /** The envelope actually submitted (signedXdr, or its fee bump). */
  submittedXdr: string;
}

/** A fresh idempotency key for one user-confirmed submission. */
export function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Sign a backend-built transaction with the connected wallet, optionally
 * fee-bump it, submit it through /wallet/submit and refresh the account.
 * Unlike the generic `useSignAndSubmit`, this is a mutation for the payment
 * flows: fee bumps, idempotent retries and account invalidation built in.
 */
export function useWalletSubmit() {
  const { wallet } = useAuth();
  const account = useCurrentAccount();
  const queryClient = useQueryClient();

  return useMutation<WalletSubmitOutput, Error, WalletSubmitInput>({
    mutationFn: async ({ xdr, networkPassphrase: passphrase, perOperationFee, idempotencyKey }) => {
      if (passphrase !== networkPassphrase()) {
        throw new WalletError("WRONG_NETWORK", "The server built this transaction for a different network than the app uses.");
      }
      const signedXdr = await wallet.signTransaction(xdr, { networkPassphrase: passphrase, address: account });
      let submittedXdr = signedXdr;
      if (perOperationFee && needsFeeBump(signedXdr, passphrase, perOperationFee)) {
        const bump = buildFeeBump(signedXdr, account, perOperationFee, passphrase);
        submittedXdr = await wallet.signTransaction(bump, { networkPassphrase: passphrase, address: account });
      }
      const result = await api.wallet.submit(submittedXdr, { account, idempotencyKey });
      return { result, signedXdr, submittedXdr };
    },
    // A failed submission can still consume a fee, so refresh either way.
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.account.all(account) }),
  });
}
