"use client";

import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { AssetPicker, type AssetOption } from "@/components/send/AssetPicker";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { api } from "@/lib/api";
import { describeError } from "@/lib/api/errors";
import { parseAssetId } from "@/lib/stellar/asset";
import { validateMemo, memoTypeToSep7, type MemoType } from "@/lib/stellar/memo";
import { amountError } from "@/lib/stellar/sendable";
import { PaymentRequestResult } from "./PaymentRequestResult";

const MEMO_TYPES = [
  { value: "text", label: "Text" },
  { value: "id", label: "ID" },
  { value: "hash", label: "Hash" },
];

/** Create a SEP-7 payment request (POST /wallet/payment-requests) for this account. */
export function PaymentRequestForm({ account, assets }: { account: string; assets: AssetOption[] }) {
  const [assetId, setAssetId] = useState("XLM");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [memoType, setMemoType] = useState<Exclude<MemoType, "none">>("text");
  const [touched, setTouched] = useState(false);

  const create = useMutation({
    mutationFn: () => {
      const asset = parseAssetId(assetId);
      return api.wallet.createPaymentRequest(account, {
        destination: account,
        amount: amount.trim() || undefined,
        asset_code: asset?.issuer ? asset.code : undefined,
        asset_issuer: asset?.issuer,
        memo: memo || undefined,
        memo_type: memo ? memoTypeToSep7(memoType) : undefined,
      });
    },
  });

  const errors = {
    amount: amount.trim() === "" ? null : amountError(amount),
    memo: validateMemo(memoType, memo),
  };

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!errors.amount && !errors.memo) create.mutate();
  }

  return (
    <Card>
      <CardHeader title="Request a payment" description="Create a link or QR code that fills in the payment for the payer." />
      <CardBody className="flex flex-col gap-4">
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" aria-label="Create payment request">
          <AssetPicker label="Asset to receive" options={assets} value={assetId} onChange={setAssetId} />
          <Input
            label="Amount (optional)"
            inputMode="decimal"
            placeholder="Leave empty to let the payer choose"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(",", "."))}
            error={touched ? (errors.amount ?? undefined) : undefined}
          />
          <div className="grid grid-cols-[7rem_1fr] items-start gap-2">
            <Select
              label="Memo type"
              options={MEMO_TYPES}
              value={memoType}
              onChange={(event) => setMemoType(event.target.value as Exclude<MemoType, "none">)}
            />
            <Input
              label="Memo (optional)"
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              error={errors.memo ?? undefined}
            />
          </div>
          {create.isError && (
            <p role="alert" className="text-sm text-danger">
              {describeError(create.error)}
            </p>
          )}
          <div>
            <Button type="submit" loading={create.isPending}>
              Create request
            </Button>
          </div>
        </form>
        {create.data && <PaymentRequestResult uri={create.data.uri} />}
      </CardBody>
    </Card>
  );
}
