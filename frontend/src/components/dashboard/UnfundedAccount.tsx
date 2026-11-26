"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { WalletIcon } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { describeError } from "@/lib/api/errors";
import { env } from "@/lib/env";
import { queryKeys } from "@/lib/query/keys";

/** Shown when Horizon has no record of the account yet (it needs 1 XLM to exist). */
export function UnfundedAccount({ account }: { account: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const fund = useMutation({
    mutationFn: () => api.dev.fund(account),
    onSuccess: async (result) => {
      toast.show({
        tone: "success",
        title: result.alreadyFunded ? "Account already funded" : "Account funded",
        description: "Testnet XLM from Friendbot is on its way.",
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.account.all(account) });
    },
    onError: (error) => toast.show({ tone: "danger", title: "Funding failed", description: describeError(error) }),
  });

  return (
    <EmptyState
      icon={<WalletIcon />}
      title="This account isn't on the network yet"
      description="A Stellar account is created when it first receives at least 1 XLM. Send XLM to your address to activate it."
      action={
        env.network === "testnet" ? (
          <Button onClick={() => fund.mutate()} loading={fund.isPending}>
            Fund with Friendbot
          </Button>
        ) : undefined
      }
    />
  );
}
