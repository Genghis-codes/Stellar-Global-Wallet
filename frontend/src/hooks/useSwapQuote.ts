"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query/keys";
import { isValidAmount, toStroops } from "@/lib/stellar/amount";
import { bestPath, type SwapMode } from "@/lib/swap/quote";
import { useCurrentAccount } from "./useAccount";
import { useDebouncedValue } from "./useDebouncedValue";

export interface SwapQuoteInput {
  mode: SwapMode;
  /** Exact amount: of `from` in "send" mode, of `to` in "receive" mode. */
  amount: string;
  /** Asset ids ("XLM" or "CODE:ISSUER"). */
  from: string;
  to: string;
}

/** Whether a quote can be requested for these inputs. */
export function canQuote({ amount, from, to }: SwapQuoteInput): boolean {
  return Boolean(from && to) && from !== to && isValidAmount(amount) && toStroops(amount) > 0n;
}

/**
 * Best path-payment route for a swap, from POST /wallet/paths/strict-send
 * (exact input) or /paths/strict-receive (exact output). The amount is
 * debounced while typing, and the quote refreshes every 15s since order
 * books move.
 */
export function useSwapQuote(input: SwapQuoteInput, debounceMs = 400) {
  const account = useCurrentAccount();
  const amount = useDebouncedValue(input.amount.trim(), debounceMs);
  const { mode, from, to } = input;
  const settled = { mode, amount, from, to };

  return useQuery({
    queryKey: queryKeys.swap.quote(account, mode, from, to, amount),
    queryFn: ({ signal }) =>
      mode === "send"
        ? api.wallet.strictSendPaths(account, { sourceAmount: amount, sourceAsset: from, destinationAsset: to }, signal)
        : api.wallet.strictReceivePaths(
            account,
            { destinationAmount: amount, destinationAsset: to, sourceAsset: from },
            signal,
          ),
    select: (paths) => bestPath(paths, mode),
    enabled: canQuote(settled) && amount === input.amount.trim(),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}
