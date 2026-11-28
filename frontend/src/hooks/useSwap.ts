"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PathPaymentBuild, PaymentPath } from "@/lib/api/endpoints/wallet";
import { queryKeys } from "@/lib/query/keys";
import { pathAssetIds, type SwapMode } from "@/lib/swap/quote";
import { useCurrentAccount } from "./useAccount";
import { newIdempotencyKey, useWalletSubmit, type WalletSubmitOutput } from "./useWalletSubmit";

export interface SwapRequest {
  mode: SwapMode;
  /** Asset ids ("XLM" or "CODE:ISSUER"). */
  from: string;
  to: string;
  /** Exact side's amount. */
  amount: string;
  slippageBps: number;
  /** The route the user reviewed. */
  quote: PaymentPath;
}

export interface SwapResult extends WalletSubmitOutput {
  build: PathPaymentBuild;
}

/**
 * Execute a swap: build a path payment from the account to itself at the
 * quoted price (the backend applies the slippage bound), sign it in the
 * wallet and submit it. Balances and swap quotes are refreshed afterwards.
 */
export function useSwap() {
  const account = useCurrentAccount();
  const submit = useWalletSubmit();
  const queryClient = useQueryClient();

  return useMutation<SwapResult, Error, SwapRequest>({
    mutationFn: async (request) => {
      const common = {
        sourcePublicKey: account,
        destinationPublicKey: account,
        sendAsset: request.from,
        destAsset: request.to,
        path: pathAssetIds(request.quote),
        slippageBps: request.slippageBps,
      };
      const build =
        request.mode === "send"
          ? await api.wallet.buildStrictSend({
              ...common,
              sendAmount: request.amount,
              quotedDestAmount: request.quote.destination_amount,
            })
          : await api.wallet.buildStrictReceive({
              ...common,
              destAmount: request.amount,
              quotedSendAmount: request.quote.source_amount,
            });
      const output = await submit.mutateAsync({
        xdr: build.xdr,
        networkPassphrase: build.networkPassphrase,
        idempotencyKey: newIdempotencyKey(),
      });
      return { ...output, build };
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.swap.all(account) }),
  });
}
