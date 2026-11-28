"use client";

import type { FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardFooter } from "@/components/ui/Card";
import type { NetworkFeesResponse } from "@/lib/api/endpoints/config";
import { AmountInput } from "./AmountInput";
import { AssetPicker, type AssetOption } from "./AssetPicker";
import { FeePicker, type FeeTier } from "./FeePicker";
import { MemoInput } from "./MemoInput";
import { RecipientInput } from "./RecipientInput";
import type { RecipientState } from "./useRecipient";

export interface SendFormValues {
  to: string;
  assetId: string;
  amount: string;
  memo: string;
  fee: FeeTier;
}

export interface SendFormErrors {
  to?: string | null;
  amount?: string | null;
  memo?: string | null;
  /** Problems that aren't tied to one field (e.g. an unsupported memo type). */
  form?: string | null;
}

export interface SendFormProps {
  values: SendFormValues;
  onChange: (patch: Partial<SendFormValues>) => void;
  recipient: RecipientState;
  assets: AssetOption[];
  maxAmount: string;
  reserve?: string;
  fees: NetworkFeesResponse | undefined;
  errors: SendFormErrors;
  /** Show field errors (after the first submit attempt or on blur). */
  showErrors: boolean;
  memoRequired?: boolean;
  memoLocked?: boolean;
  self: string;
  submitting?: boolean;
  onSubmit: () => void;
}

/** Step 1 of Send: recipient, asset, amount, memo and fee. */
export function SendForm({
  values,
  onChange,
  recipient,
  assets,
  maxAmount,
  reserve,
  fees,
  errors,
  showErrors,
  memoRequired,
  memoLocked,
  self,
  submitting,
  onSubmit,
}: SendFormProps) {
  const selected = assets.find((option) => option.id === values.assetId);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} noValidate aria-label="Send payment">
        <CardBody className="flex flex-col gap-5">
          <RecipientInput
            value={values.to}
            onChange={(to) => onChange({ to })}
            state={{ ...recipient, error: errors.to ?? recipient.error }}
            showError={showErrors || Boolean(recipient.error)}
            self={self}
          />
          <AssetPicker options={assets} value={values.assetId} onChange={(assetId) => onChange({ assetId })} />
          <AmountInput
            value={values.amount}
            onChange={(amount) => onChange({ amount })}
            assetCode={selected?.asset.code ?? "XLM"}
            max={maxAmount}
            reserve={selected?.asset.issuer ? undefined : reserve}
            error={showErrors ? errors.amount : null}
          />
          <MemoInput
            value={values.memo}
            onChange={(memo) => onChange({ memo })}
            error={errors.memo}
            required={memoRequired}
            locked={memoLocked}
          />
          <FeePicker fees={fees} value={values.fee} onChange={(fee) => onChange({ fee })} />
          {errors.form && (
            <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
              {errors.form}
            </p>
          )}
        </CardBody>
        <CardFooter className="justify-end">
          <Button type="submit" loading={submitting} disabled={recipient.resolving}>
            Review
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
