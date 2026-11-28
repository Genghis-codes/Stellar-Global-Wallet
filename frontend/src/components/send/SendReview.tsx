"use client";

import type { ReactNode } from "react";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { AmountDisplay } from "@/components/ui/AmountDisplay";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/Card";
import type { SendPrecheckWarning } from "@/lib/api/endpoints/wallet";
import { PrecheckWarnings } from "./PrecheckWarnings";
import type { Recipient } from "./useRecipient";

export interface SendReviewProps {
  recipient: Recipient;
  amount: string;
  assetCode: string;
  memo?: string;
  /** Total network fee in XLM. */
  feeXlm: string;
  /** The fee is above what the build offers: a second (fee-bump) signature follows. */
  feeBump?: boolean;
  createsAccount?: boolean;
  warnings: SendPrecheckWarning[];
  blocking: boolean;
  /** ISO time the built transaction expires. */
  expiresAt?: string | null;
  signing?: boolean;
  onConfirm: () => void;
  onBack: () => void;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="text-right text-sm text-fg">{children}</dd>
    </div>
  );
}

/** Review step: everything the user is about to sign, plus precheck warnings. */
export function SendReview({
  recipient,
  amount,
  assetCode,
  memo,
  feeXlm,
  feeBump,
  createsAccount,
  warnings,
  blocking,
  expiresAt,
  signing,
  onConfirm,
  onBack,
}: SendReviewProps) {
  return (
    <Card>
      <CardHeader title="Review payment" description="Check the details. Your wallet will ask you to approve." />
      <CardBody className="flex flex-col gap-4">
        <dl className="divide-y divide-border">
          <Row label="To">
            <span className="flex flex-col items-end gap-0.5">
              {recipient.federationAddress && <span className="font-medium">{recipient.federationAddress}</span>}
              <AddressDisplay address={recipient.destination} chars={6} />
              {createsAccount && <Badge tone="info">New account</Badge>}
            </span>
          </Row>
          <Row label="Amount">
            <span className="font-semibold">
              <AmountDisplay amount={amount} asset={assetCode} />
            </span>
          </Row>
          {memo && <Row label="Memo">{memo}</Row>}
          <Row label="Network fee">
            {feeXlm} XLM{feeBump && <span className="block text-xs text-fg-muted">Fee bump: two wallet approvals</span>}
          </Row>
          {expiresAt && <Row label="Valid until">{new Date(expiresAt).toLocaleTimeString()}</Row>}
        </dl>
        <PrecheckWarnings warnings={warnings} />
      </CardBody>
      <CardFooter className="justify-end">
        <Button variant="ghost" onClick={onBack} disabled={signing}>
          Back
        </Button>
        <Button onClick={onConfirm} loading={signing} disabled={blocking}>
          {signing ? "Waiting for wallet…" : "Sign and send"}
        </Button>
      </CardFooter>
    </Card>
  );
}
