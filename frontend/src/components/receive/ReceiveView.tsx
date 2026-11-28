"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { assetOptions } from "@/components/send/AssetPicker";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { Card, CardBody } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { isUnfundedAccountError, useAccountReserves, useCurrentAccount } from "@/hooks/useAccount";
import { NATIVE } from "@/lib/stellar/asset";
import { MuxedAddressGenerator } from "./MuxedAddressGenerator";
import { PaymentRequestForm } from "./PaymentRequestForm";
import { QrCode } from "./QrCode";

/** /receive: the account's address as QR + text, muxed addresses and payment requests. */
export function ReceiveView() {
  const account = useCurrentAccount();
  const reserves = useAccountReserves(account);
  const held = assetOptions(reserves.data?.balances ?? []);
  // An unfunded account can still be paid in XLM (that's how it gets created).
  const assets = held.length > 0 ? held : [{ id: "XLM", asset: NATIVE, balance: "0", spendable: "0" }];

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <PageHeader title="Receive" description="Share your address to get paid on Stellar." />
      <Card>
        <CardBody className="flex flex-col items-center gap-4 text-center">
          <QrCode value={account} size={208} label="Your Stellar address as a QR code" />
          <div className="flex max-w-full items-center gap-1">
            <AddressDisplay address={account} full copyable={false} className="text-center" />
            <CopyButton value={account} label="Copy address" />
          </div>
          {reserves.isError && isUnfundedAccountError(reserves.error) && (
            <p className="rounded-lg bg-info-soft p-3 text-sm text-info">
              This account isn&apos;t funded yet. The first payment must be at least 1 XLM to create it.
            </p>
          )}
          <p className="text-xs text-fg-muted">
            Only send Stellar assets to this address. To receive an asset other than XLM, add a trustline for it first.
          </p>
        </CardBody>
      </Card>
      <PaymentRequestForm account={account} assets={assets} />
      <MuxedAddressGenerator account={account} />
    </div>
  );
}
