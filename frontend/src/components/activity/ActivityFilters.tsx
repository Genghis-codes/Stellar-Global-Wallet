"use client";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  DEFAULT_FILTERS,
  hasActiveFilters,
  type ActivityFilters as Filters,
  type ActivityTypeFilter,
  type DirectionFilter,
} from "@/lib/activity/filters";
import { parseAssetId } from "@/lib/stellar/asset";
import { truncateAddress } from "@/lib/format";

export interface ActivityFiltersProps {
  value: Filters;
  onChange: (next: Filters) => void;
  /** Asset ids to offer ("XLM", "CODE:ISSUER"). */
  assets: string[];
}

const TYPE_OPTIONS: Array<{ value: ActivityTypeFilter; label: string }> = [
  { value: "all", label: "All types" },
  { value: "payment", label: "Payments" },
  { value: "path_payment", label: "Path payments" },
  { value: "account", label: "Account changes" },
];

const DIRECTION_OPTIONS: Array<{ value: DirectionFilter; label: string }> = [
  { value: "all", label: "Any direction" },
  { value: "in", label: "Received" },
  { value: "out", label: "Sent" },
  { value: "self", label: "Self" },
];

function assetLabel(id: string): string {
  const asset = parseAssetId(id);
  if (!asset || !asset.issuer) return "XLM";
  return `${asset.code} (${truncateAddress(asset.issuer, 4, 4)})`;
}

/** Filter bar for the payments list. Controlled; state lives in the URL. */
export function ActivityFilters({ value, onChange, assets }: ActivityFiltersProps) {
  const assetChoices = value.asset !== "all" && !assets.includes(value.asset) ? [...assets, value.asset] : assets;
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });

  return (
    <div role="group" aria-label="Filters" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 lg:items-end">
      <Select
        label="Type"
        value={value.type}
        options={TYPE_OPTIONS}
        onChange={(e) => set({ type: e.target.value as ActivityTypeFilter })}
      />
      <Select
        label="Direction"
        value={value.direction}
        options={DIRECTION_OPTIONS}
        onChange={(e) => set({ direction: e.target.value as DirectionFilter })}
      />
      <Select
        label="Asset"
        value={value.asset}
        options={[{ value: "all", label: "All assets" }, ...assetChoices.map((id) => ({ value: id, label: assetLabel(id) }))]}
        onChange={(e) => set({ asset: e.target.value })}
      />
      <Input label="From" type="date" value={value.from} max={value.to || undefined} onChange={(e) => set({ from: e.target.value })} />
      <Input label="To" type="date" value={value.to} min={value.from || undefined} onChange={(e) => set({ to: e.target.value })} />
      <Button variant="ghost" disabled={!hasActiveFilters(value)} onClick={() => onChange(DEFAULT_FILTERS)}>
        Clear filters
      </Button>
    </div>
  );
}
