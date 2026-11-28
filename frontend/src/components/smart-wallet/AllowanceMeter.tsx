import { AmountDisplay } from "@/components/ui/AmountDisplay";
import type { SpendAllowance } from "@/lib/api/endpoints/contract";
import { fromStroops } from "@/lib/stellar/amount";

/** Spent vs limit for one asset over the rolling 24 h window. */
export function AllowanceMeter({ allowance }: { allowance: SpendAllowance }) {
  const { assetCode, unlimited } = allowance;
  const limit = BigInt(allowance.limit);
  const spent = BigInt(allowance.spent);
  const percent = unlimited || limit === 0n ? 0 : Number((spent * 100n) / limit);
  const used = Math.min(100, percent);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <span className="text-fg-muted">
          Spent <AmountDisplay amount={fromStroops(spent)} asset={assetCode} className="text-fg" />
        </span>
        <span className="text-fg-muted">
          {unlimited ? (
            "No limit"
          ) : (
            <>
              <AmountDisplay amount={fromStroops(allowance.remaining ?? "0")} asset={assetCode} className="text-fg" /> left
              of <AmountDisplay amount={fromStroops(limit)} asset={assetCode} />
            </>
          )}
        </span>
      </div>
      {!unlimited && (
        <div
          role="meter"
          aria-label={`${assetCode} limit used`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={used}
          className="h-2 overflow-hidden rounded-full bg-surface-muted"
        >
          <div
            className={used >= 90 ? "h-full rounded-full bg-danger" : used >= 70 ? "h-full rounded-full bg-warning" : "h-full rounded-full bg-primary"}
            style={{ width: `${used}%` }}
          />
        </div>
      )}
    </div>
  );
}
