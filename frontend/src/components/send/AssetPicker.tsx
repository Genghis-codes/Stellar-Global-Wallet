"use client";

import { Select } from "@/components/ui/Select";
import type { ReservesResponse } from "@/lib/api/endpoints/account";
import { formatAmount, truncateAddress } from "@/lib/format";
import { assetFromBalanceLine, assetId, compareAssets, type AssetRef } from "@/lib/stellar/asset";

export interface AssetOption {
  id: string;
  asset: AssetRef;
  balance: string;
  spendable: string;
}

/** Sendable assets from a reserves response: native first, no pool shares, nothing unauthorized. */
export function assetOptions(balances: ReservesResponse["balances"]): AssetOption[] {
  return balances
    .flatMap((line) => {
      const asset = assetFromBalanceLine(line);
      if (!asset || line.is_authorized === false) return [];
      return [{ id: assetId(asset), asset, balance: line.balance, spendable: line.spendable }];
    })
    .sort((a, b) => compareAssets(a.asset, b.asset));
}

export interface AssetPickerProps {
  options: AssetOption[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  disabled?: boolean;
}

function optionLabel({ asset, spendable }: AssetOption, duplicateCode: boolean): string {
  const issuer = duplicateCode && asset.issuer ? ` (${truncateAddress(asset.issuer, 4, 4)})` : "";
  return `${asset.code}${issuer} · ${formatAmount(spendable)} available`;
}

/** Pick one of the account's assets; issuers are shown when two assets share a code. */
export function AssetPicker({ options, value, onChange, label = "Asset", disabled }: AssetPickerProps) {
  const counts = new Map<string, number>();
  for (const option of options) counts.set(option.asset.code, (counts.get(option.asset.code) ?? 0) + 1);

  return (
    <Select
      label={label}
      value={value}
      disabled={disabled || options.length === 0}
      onChange={(event) => onChange(event.target.value)}
      options={options.map((option) => ({
        value: option.id,
        label: optionLabel(option, (counts.get(option.asset.code) ?? 0) > 1),
      }))}
    />
  );
}
