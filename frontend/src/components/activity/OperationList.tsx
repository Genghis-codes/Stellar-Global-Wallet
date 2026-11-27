import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { AmountDisplay } from "@/components/ui/AmountDisplay";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { operationTypeLabel, renderHistoryItem } from "@/lib/activity/operations";
import type { HistoryItem } from "@/lib/api/endpoints/transactions";
import { accountUrl, explorerUrl } from "@/lib/stellar/explorer";

const isContract = (address: string) => address.startsWith("C");

/** Every operation in a transaction, described from the viewer's side. */
export function OperationList({ operations }: { operations: HistoryItem[] }) {
  return (
    <Card>
      <CardHeader title="Operations" description={`${operations.length} ${operations.length === 1 ? "operation" : "operations"}`} />
      {operations.length === 0 ? (
        <p className="px-5 py-4 text-sm text-fg-muted">No operation details are available for this transaction.</p>
      ) : (
        <ol className="divide-y divide-border px-5 pb-2 pt-3">
          {operations.map((item, index) => {
            const op = renderHistoryItem(item);
            return (
              <li key={item.id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
                    <span className="text-fg-muted">{index + 1}.</span>
                    {op.title}
                    <Badge>{operationTypeLabel(item.operationType)}</Badge>
                    {op.failed && <Badge tone="danger">Failed</Badge>}
                  </p>
                  {op.description && <p className="text-sm text-fg-muted">{op.description}</p>}
                  {op.counterparty && (
                    <AddressDisplay
                      address={op.counterparty}
                      href={isContract(op.counterparty) ? explorerUrl("contract", op.counterparty) : accountUrl(op.counterparty)}
                      className="text-sm text-fg-muted"
                    />
                  )}
                  {item.contractFunction && <p className="text-xs text-fg-muted">Function: {item.contractFunction}</p>}
                </div>
                {op.amount && (
                  <p className="shrink-0 text-right font-medium text-fg">
                    {op.sign === "-" && "−"}
                    <AmountDisplay amount={op.amount} asset={op.assetCode ?? undefined} signed={op.sign === "+"} />
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
