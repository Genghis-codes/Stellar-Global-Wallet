import Link from "next/link";
import { AmountDisplay } from "@/components/ui/AmountDisplay";
import { Badge } from "@/components/ui/Badge";
import type { OperationKind, RenderedOperation } from "@/lib/activity/operations";
import { cn } from "@/lib/cn";

export interface ActivityRowProps {
  op: RenderedOperation;
  timestamp: string;
  /** Link to the transaction detail page. */
  href?: string;
  /** Suspicious-payment flags from the payments feed (dust, memo_url, unknown_asset). */
  flags?: string[];
}

const GLYPH: Partial<Record<OperationKind, string>> = {
  received: "↓",
  sent: "↑",
  swap: "⇄",
  account_funded: "↓",
  account_created: "+",
  trustline_added: "+",
  trustline_removed: "−",
  claimable_created: "◇",
  claimable_claimed: "◆",
  contract: "⌘",
  merge: "⤵",
};

const FLAG_LABELS: Record<string, string> = {
  dust: "Dust",
  memo_url: "Link in memo",
  unknown_asset: "Unverified asset",
};

export function formatActivityTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** One line in an activity list: icon, headline, counterparty, amount and time. */
export function ActivityRow({ op, timestamp, href, flags = [] }: ActivityRowProps) {
  const body = (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
            op.sign === "+" ? "bg-success-soft text-success" : op.sign === "-" ? "bg-surface-muted text-fg" : "bg-info-soft text-info",
          )}
        >
          {GLYPH[op.kind] ?? "•"}
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
            {op.title}
            {op.failed && <Badge tone="danger">Failed</Badge>}
            {flags.map((flag) => (
              <Badge key={flag} tone="warning">
                {FLAG_LABELS[flag] ?? flag}
              </Badge>
            ))}
          </p>
          <p className="truncate text-sm text-fg-muted">
            {op.description ? `${op.description} · ` : ""}
            <time dateTime={timestamp}>{formatActivityTime(timestamp)}</time>
          </p>
        </div>
      </div>
      {op.amount && (
        <p className={cn("shrink-0 text-right font-medium", op.sign === "+" ? "text-success" : "text-fg", op.failed && "line-through")}>
          {op.sign === "-" && "−"}
          <AmountDisplay amount={op.amount} asset={op.assetCode ?? undefined} signed={op.sign === "+"} />
        </p>
      )}
    </div>
  );

  return (
    <li>
      {href ? (
        <Link href={href} className="-mx-2 block rounded-lg px-2 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}
