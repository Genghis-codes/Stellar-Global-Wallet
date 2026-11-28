"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { useCurrentAccount } from "@/hooks/useAccount";
import { useAuth } from "@/hooks/useAuth";
import { useFeatureFlags, useNetworkFees } from "@/hooks/useServerConfig";
import { newIdempotencyKey } from "@/hooks/useWalletSubmit";
import { api } from "@/lib/api";
import { isApiError } from "@/lib/api/errors";
import type { SubmitResult } from "@/lib/api/endpoints/wallet";
import { queryKeys } from "@/lib/query/keys";
import { formatAmount } from "@/lib/format";
import { fromStroops } from "@/lib/stellar/amount";
import { buildFeeBump, feeBumpTotal, feePerOperation } from "@/lib/stellar/feeBump";
import { describeTxError } from "./txErrors";

export interface FeeBumpActionProps {
  /** The signed inner transaction that is stuck or was rejected for its fee. */
  signedXdr: string;
  networkPassphrase: string;
  /** Called with the fee bump's submit result. */
  onSubmitted: (result: SubmitResult) => void;
}

/** Backend error codes that mean "the fee was too low" (the signed transaction is still usable). */
export const LOW_FEE_CODES = new Set(["INSUFFICIENT_FEE", "HORIZON_TX_INSUFFICIENT_FEE"]);

/**
 * "Speed up" for a transaction that timed out or was rejected for its fee:
 * re-submits the same signed transaction inside a fee bump, paid either by
 * the user's account (one more wallet approval) or, when the server has a
 * fee sponsor, by GlobeWallet (POST /wallet/sponsor-fee).
 */
export function FeeBumpAction({ signedXdr, networkPassphrase, onSubmitted }: FeeBumpActionProps) {
  const account = useCurrentAccount();
  const { wallet } = useAuth();
  const queryClient = useQueryClient();
  const flags = useFeatureFlags();
  const fees = useNetworkFees();

  // At least double what the transaction offered, and no less than the "high" tier.
  const current = feePerOperation(signedXdr, networkPassphrase);
  const high = BigInt(fees.data?.high.stroops ?? "0");
  const perOp = current * 2n > high ? current * 2n : high;
  const total = feeBumpTotal(signedXdr, networkPassphrase, perOp);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.account.all(account) });

  const selfPay = useMutation({
    mutationFn: async () => {
      const bump = buildFeeBump(signedXdr, account, perOp, networkPassphrase);
      const signed = await wallet.signTransaction(bump, { networkPassphrase, address: account });
      return api.wallet.submit(signed, { account, idempotencyKey: newIdempotencyKey() });
    },
    onSuccess: (result) => onSubmitted(result),
    onSettled: refresh,
  });

  const sponsored = useMutation({
    mutationFn: () => api.wallet.sponsorFee(account, signedXdr),
    onSuccess: (result) => onSubmitted(result),
    onSettled: refresh,
  });

  const sponsorUnavailable = isApiError(sponsored.error) && sponsored.error.code === "FEE_SPONSOR_NOT_CONFIGURED";
  const error = describeTxError(selfPay.error) ?? (sponsorUnavailable ? null : describeTxError(sponsored.error));
  const busy = selfPay.isPending || sponsored.isPending;

  if (flags.data && !flags.data.feeBump) return null;

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-2 rounded-lg border border-border p-3">
      <p className="text-sm text-fg-muted">Raise the fee to get it included faster.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" onClick={() => selfPay.mutate()} loading={selfPay.isPending} disabled={busy}>
          Speed up ({formatAmount(fromStroops(total))} XLM)
        </Button>
        {!sponsorUnavailable && (
          <Button size="sm" variant="secondary" onClick={() => sponsored.mutate()} loading={sponsored.isPending} disabled={busy}>
            Let GlobeWallet pay the fee
          </Button>
        )}
      </div>
      {sponsorUnavailable && <p className="text-xs text-fg-muted">Fee sponsorship isn&apos;t available on this server.</p>}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
