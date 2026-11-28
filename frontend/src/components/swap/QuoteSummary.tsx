import { AmountDisplay } from "@/components/ui/AmountDisplay";
import type { PaymentPath } from "@/lib/api/endpoints/wallet";
import { exchangeRate, formatBps, maxSent, minReceived, routeCodes, type SwapMode } from "@/lib/swap/quote";

export interface QuoteSummaryProps {
  quote: PaymentPath;
  mode: SwapMode;
  slippageBps: number;
  fromCode: string;
  toCode: string;
}

/** Rate, route and the slippage-protected bound for a swap quote. */
export function QuoteSummary({ quote, mode, slippageBps, fromCode, toCode }: QuoteSummaryProps) {
  const rate = exchangeRate(quote.source_amount, quote.destination_amount);
  const route = routeCodes(quote);
  const rows: Array<[string, React.ReactNode]> = [
    [
      "Rate",
      rate ? (
        <>
          1 {fromCode} ≈ <AmountDisplay amount={rate} asset={toCode} />
        </>
      ) : (
        "—"
      ),
    ],
    ["Route", route.join(" → ")],
    mode === "send"
      ? ["Minimum received", <AmountDisplay key="min" amount={minReceived(quote.destination_amount, slippageBps)} asset={toCode} />]
      : ["Maximum spent", <AmountDisplay key="max" amount={maxSent(quote.source_amount, slippageBps)} asset={fromCode} />],
    ["Slippage tolerance", formatBps(slippageBps)],
  ];

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg bg-surface-muted p-4 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-fg-muted">{label}</dt>
          <dd className="text-right text-fg">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
