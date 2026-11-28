"use client";

import Link from "next/link";
import { AmountDisplay } from "@/components/ui/AmountDisplay";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { pendingClaimables, useClaimableBalances } from "@/hooks/useClaimableBalances";
import { codeFromCanonical } from "@/lib/activity/operations";

const PREVIEW = 3;

/** Dashboard nudge: balances waiting to be claimed. Renders nothing when there are none. */
export function PendingClaimablesCard({ account }: { account: string }) {
  const balances = useClaimableBalances(account);
  const pending = pendingClaimables(balances.data, account);
  if (pending.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Funds waiting for you"
        description={`${pending.length} claimable ${pending.length === 1 ? "balance" : "balances"} ready to claim`}
        action={
          <Link href="/claimable" className="text-sm font-medium text-primary hover:underline">
            Review and claim
          </Link>
        }
      />
      <CardBody className="pt-3">
        <ul aria-label="Pending claimable balances" className="flex flex-col gap-1">
          {pending.slice(0, PREVIEW).map((balance) => (
            <li key={balance.id} className="text-sm font-medium text-fg">
              <AmountDisplay amount={balance.amount} asset={codeFromCanonical(balance.asset) ?? balance.asset} />
            </li>
          ))}
          {pending.length > PREVIEW && <li className="text-sm text-fg-muted">and {pending.length - PREVIEW} more</li>}
        </ul>
      </CardBody>
    </Card>
  );
}
