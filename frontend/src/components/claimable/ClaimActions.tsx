"use client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useAccountTransaction } from "@/hooks/useAccountTransaction";
import { canReclaim } from "@/hooks/useClaimableBalances";
import { phaseLabel, useTxErrorToast } from "@/hooks/useSignAndSubmit";
import { api } from "@/lib/api";
import { codeFromCanonical } from "@/lib/activity/operations";
import type { ClaimableBalance } from "@/lib/api/endpoints/account";

/** Claim (or, for balances the account sent, reclaim) a claimable balance. */
export function ClaimActions({ balance, account }: { balance: ClaimableBalance; account: string }) {
  const toast = useToast();
  const errorToast = useTxErrorToast();
  const { execute, phase, busy } = useAccountTransaction(account);
  const code = codeFromCanonical(balance.asset) ?? balance.asset;
  const reclaim = canReclaim(balance, account);

  if (!balance.claimableNow) return null;

  async function run() {
    try {
      let createdTrustline = false;
      const outcome = await execute(async () => {
        const built = reclaim
          ? await api.account.buildReclaim(account, balance.id)
          : await api.account.buildClaim(account, balance.id);
        createdTrustline = built.createdTrustline;
        return built;
      });
      toast.show({
        title: outcome.pending ? "Submitted, waiting for the network" : reclaim ? `${code} reclaimed` : `${code} claimed`,
        description: createdTrustline ? `A ${code} trustline was added so you can hold it (0.5 XLM reserve).` : undefined,
        tone: "success",
      });
    } catch (err) {
      errorToast(err, reclaim ? "Couldn't reclaim" : "Couldn't claim");
    }
  }

  return (
    <Button size="sm" variant={reclaim ? "secondary" : "primary"} loading={busy} onClick={() => void run()}>
      {phaseLabel(phase, reclaim ? "Reclaim" : "Claim")}
    </Button>
  );
}
