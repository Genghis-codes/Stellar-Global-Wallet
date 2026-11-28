"use client";

import { useSearchParams } from "next/navigation";
import { parseAssetId } from "@/lib/stellar/asset";
import { SendView } from "./SendView";

/**
 * /send entry point: turns `?to=&amount=&asset=&memo=` (set by payment
 * request links) into the form's initial values. Values are only a
 * starting point; the form validates them like typed input.
 */
export function SendPage() {
  const params = useSearchParams();
  const asset = params.get("asset");
  const parsed = asset ? parseAssetId(asset) : null;
  const initial = {
    to: params.get("to") ?? undefined,
    amount: params.get("amount") ?? undefined,
    memo: params.get("memo") ?? undefined,
    assetId: parsed ? (parsed.issuer ? `${parsed.code}:${parsed.issuer}` : "XLM") : undefined,
  };
  // Remount when the query changes so a new request link resets the form.
  return <SendView key={params.toString()} initial={initial} />;
}
