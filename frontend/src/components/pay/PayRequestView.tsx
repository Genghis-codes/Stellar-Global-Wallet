"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { AmountDisplay } from "@/components/ui/AmountDisplay";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useCurrentAccount } from "@/hooks/useAccount";
import { api } from "@/lib/api";
import { describeError } from "@/lib/api/errors";
import type { Sep7PayFields } from "@/lib/api/endpoints/wallet";
import { queryKeys } from "@/lib/query/keys";
import { memoTypeFromSep7 } from "@/lib/stellar/memo";

/** /send?… query that pre-fills the send form from a parsed request. */
export function sendHrefFor(fields: Sep7PayFields): string {
  const params = new URLSearchParams({ to: fields.destination });
  if (fields.amount) params.set("amount", fields.amount);
  if (fields.asset_code && fields.asset_code !== "XLM" && fields.asset_issuer) {
    params.set("asset", `${fields.asset_code}:${fields.asset_issuer}`);
  }
  if (fields.memo) params.set("memo", fields.memo);
  return `/send?${params.toString()}`;
}

/** /pay?uri=web+stellar:pay?… — show a payment request and hand it to the send flow. */
export function PayRequestView({ uri }: { uri: string | null }) {
  const account = useCurrentAccount();
  const parsed = useQuery({
    queryKey: queryKeys.wallet.paymentRequest(uri ?? ""),
    queryFn: () => api.wallet.parsePaymentRequest(account, uri!),
    enabled: Boolean(uri),
    retry: false,
  });

  const header = <PageHeader title="Payment request" description="Someone asked you to pay them on Stellar." />;

  if (!uri) {
    return (
      <>
        {header}
        <EmptyState title="No payment request" description="This link doesn't contain a payment request." />
      </>
    );
  }
  if (parsed.isPending) {
    return (
      <>
        {header}
        <Skeleton className="h-64 rounded-[var(--radius-card)]" aria-label="Reading payment request" />
      </>
    );
  }
  if (parsed.isError) {
    return (
      <>
        {header}
        <EmptyState title="This payment request is invalid" description={describeError(parsed.error)} />
      </>
    );
  }

  const { fields, warnings } = parsed.data;
  const memoType = fields.memo ? memoTypeFromSep7(fields.memo_type) : null;
  const unsupportedMemo = memoType !== null && memoType !== "text";
  const blocked = warnings.length > 0 || unsupportedMemo;

  return (
    <div className="mx-auto w-full max-w-xl">
      {header}
      <Card>
        <CardHeader title="Pay" description={fields.origin_domain ? `Requested via ${fields.origin_domain}` : undefined} />
        <CardBody className="flex flex-col gap-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-fg-muted">To</span>
            <AddressDisplay address={fields.destination} chars={6} />
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-fg-muted">Amount</span>
            <span className="font-medium text-fg">
              {fields.amount ? <AmountDisplay amount={fields.amount} asset={fields.asset_code ?? "XLM"} /> : "You choose"}
            </span>
          </div>
          {fields.memo && (
            <div className="flex justify-between gap-4">
              <span className="text-fg-muted">Memo{memoType && memoType !== "text" ? ` (${memoType})` : ""}</span>
              <span className="text-fg">{fields.memo}</span>
            </div>
          )}
          {warnings.length > 0 && (
            <ul role="alert" className="flex flex-col gap-1 rounded-lg bg-danger-soft p-3 text-danger">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {unsupportedMemo && (
            <p role="alert" className="rounded-lg bg-warning-soft p-3 text-warning">
              This request needs a memo {memoType === "id" ? "ID" : "hash"}. GlobeWallet can only attach text memos, so
              pay it from a wallet that supports this memo type.
            </p>
          )}
        </CardBody>
        <CardFooter className="justify-end">
          {blocked ? (
            <Button disabled>Continue to send</Button>
          ) : (
            <Link
              href={sendHrefFor(fields)}
              className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary-hover"
            >
              Continue to send
            </Link>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
