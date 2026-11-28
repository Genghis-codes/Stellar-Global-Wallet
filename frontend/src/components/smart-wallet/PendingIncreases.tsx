"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Countdown } from "@/components/ui/Countdown";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import type { PendingSpendLimit } from "@/lib/contract/spendLimit";
import { fromStroops } from "@/lib/stellar/amount";
import { useContractTx } from "@/hooks/useContractTx";
import { phaseLabel, useTxErrorToast } from "@/hooks/useSignAndSubmit";

export interface PendingIncreasesProps {
  account: string;
  items: PendingSpendLimit[];
  /** Forget an entry (cancelled, or the countdown finished). */
  onRemove: (assetCode: string) => void;
}

function limitLabel(stroops: string, assetCode: string) {
  return stroops === "0" ? "unlimited" : `${fromStroops(stroops)} ${assetCode}`;
}

/**
 * Queued spend-limit increases with a countdown. Cancelling re-sets the
 * current limit: the contract treats that as a no-op that discards the
 * queued increase (there is no dedicated cancel route in the backend).
 */
export function PendingIncreases({ account, items, onRemove }: PendingIncreasesProps) {
  const toast = useToast();
  const toastError = useTxErrorToast();
  const { execute, phase } = useContractTx();
  const [cancelling, setCancelling] = useState<string | null>(null);

  if (items.length === 0) return null;

  async function cancel(item: PendingSpendLimit) {
    setCancelling(item.assetCode);
    try {
      await execute(() => api.contract.buildSetSpendLimit(account, item.assetCode, fromStroops(item.previousLimit)));
      onRemove(item.assetCode);
      toast.show({ title: "Increase cancelled", description: `${item.assetCode} keeps its current limit.`, tone: "success" });
    } catch (error) {
      toastError(error, "Couldn't cancel the increase");
    } finally {
      setCancelling(null);
    }
  }

  return (
    <Card className="border-warning">
      <CardHeader
        title="Pending increases"
        description="Raised limits wait 24 hours. If you didn't ask for one, cancel it and secure your key."
      />
      <CardBody>
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.assetCode} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="text-sm">
                <p className="font-medium text-fg">
                  {item.assetCode}: {limitLabel(item.previousLimit, item.assetCode)} →{" "}
                  {limitLabel(item.limit, item.assetCode)}
                </p>
                <p className="text-fg-muted">
                  Takes effect in <Countdown target={item.effectiveAt} doneLabel="a moment" />
                </p>
              </div>
              <Button
                variant="danger"
                size="sm"
                loading={cancelling === item.assetCode}
                disabled={cancelling !== null && cancelling !== item.assetCode}
                onClick={() => void cancel(item)}
              >
                {cancelling === item.assetCode ? phaseLabel(phase, "Cancel increase") : "Cancel increase"}
              </Button>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
