import { AmountDisplay } from "@/components/ui/AmountDisplay";
import { Card, CardBody } from "@/components/ui/Card";
import type { ReserveBreakdown } from "@/lib/api/endpoints/account";
import { subtractAmounts } from "@/lib/stellar/amount";

export interface BalanceSummaryProps {
  /** Native XLM balance of the account. */
  xlmBalance: string;
  reserves: ReserveBreakdown;
}

/** Headline XLM card: total, spendable and locked (reserve + open offers). */
export function BalanceSummary({ xlmBalance, reserves }: BalanceSummaryProps) {
  const locked = subtractAmounts(xlmBalance, reserves.spendable);
  return (
    <Card>
      <CardBody className="grid gap-6 sm:grid-cols-3">
        <div>
          <p className="text-sm text-fg-muted">Total XLM</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-fg">
            <AmountDisplay amount={xlmBalance} maxDecimals={4} />
          </p>
        </div>
        <div>
          <p className="text-sm text-fg-muted">Spendable</p>
          <p className="mt-1 text-xl font-medium text-fg">
            <AmountDisplay amount={reserves.spendable} asset="XLM" maxDecimals={4} />
          </p>
        </div>
        <div>
          <p className="text-sm text-fg-muted">Locked</p>
          <p className="mt-1 text-xl font-medium text-fg">
            <AmountDisplay amount={locked} asset="XLM" maxDecimals={4} />
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            Minimum balance {reserves.minimumBalance} XLM ({reserves.subentryCount} subentries)
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
