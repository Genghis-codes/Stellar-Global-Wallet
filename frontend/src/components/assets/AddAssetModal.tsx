"use client";

import { useDeferredValue, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { useAccountTransaction } from "@/hooks/useAccountTransaction";
import { toAssetSearchQuery, useAssetSearch, useVerifiedAssets } from "@/hooks/useAssets";
import { phaseLabel, useTxErrorToast } from "@/hooks/useSignAndSubmit";
import { api } from "@/lib/api";
import type { RiskLevel } from "@/lib/api/endpoints/assets";
import { describeError } from "@/lib/api/errors";
import { truncateAddress } from "@/lib/format";

/** An asset the user can pick, from the verified list or a search hit. */
export interface AssetChoice {
  code: string;
  issuer: string;
  domain: string | null;
  verified: boolean;
  riskLevel?: RiskLevel;
  numAccounts?: number | null;
}

const RISK_TONE: Record<RiskLevel, "success" | "info" | "warning" | "danger"> = {
  low: "success",
  medium: "info",
  high: "warning",
  critical: "danger",
};

export interface AddAssetModalProps {
  open: boolean;
  onClose: () => void;
  account: string;
  /** Asset ids ("CODE:ISSUER") the account already trusts. */
  held: Set<string>;
}

function ChoiceRow({ choice, held, onSelect }: { choice: AssetChoice; held: boolean; onSelect: () => void }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
          {choice.code}
          {choice.verified && <Badge tone="success">Verified</Badge>}
          {choice.riskLevel && !choice.verified && <Badge tone={RISK_TONE[choice.riskLevel]}>{choice.riskLevel} risk</Badge>}
        </p>
        <p className="truncate text-sm text-fg-muted">
          {choice.domain ?? "No home domain"} · {truncateAddress(choice.issuer)}
          {typeof choice.numAccounts === "number" && ` · ${choice.numAccounts.toLocaleString("en-US")} holders`}
        </p>
      </div>
      <Button size="sm" variant="secondary" disabled={held} onClick={onSelect} aria-label={`Select ${choice.code} from ${choice.domain ?? truncateAddress(choice.issuer)}`}>
        {held ? "Added" : "Select"}
      </Button>
    </li>
  );
}

/** Add-trustline flow: find an asset (verified list or search), review, sign, submit. */
export function AddAssetModal({ open, onClose, account, held }: AddAssetModalProps) {
  const toast = useToast();
  const errorToast = useTxErrorToast();
  const [input, setInput] = useState("");
  const query = useDeferredValue(input);
  const [selected, setSelected] = useState<AssetChoice | null>(null);
  const verified = useVerifiedAssets();
  const search = useAssetSearch(query);
  const { execute, phase, busy } = useAccountTransaction(account);
  const searching = toAssetSearchQuery(query) !== null;

  const choices: AssetChoice[] = searching
    ? (search.data?.results ?? []).map((r) => ({
        code: r.code,
        issuer: r.issuer,
        domain: r.homeDomain,
        verified: r.verified,
        riskLevel: r.riskLevel,
        numAccounts: r.numAccounts,
      }))
    : (verified.data ?? []).map((a) => ({ code: a.code, issuer: a.issuer, domain: a.domain, verified: true }));
  const loading = searching ? search.isPending : verified.isPending;
  const error = searching ? search.error : verified.error;

  function close() {
    if (busy) return;
    setSelected(null);
    setInput("");
    onClose();
  }

  async function add(choice: AssetChoice) {
    try {
      const outcome = await execute(() => api.wallet.buildTrustline({ account, asset: { code: choice.code, issuer: choice.issuer } }));
      toast.show({
        title: outcome.pending ? "Submitted, waiting for the network" : `${choice.code} added`,
        description: outcome.pending ? undefined : "You can now receive this asset.",
        tone: "success",
      });
      close();
    } catch (err) {
      errorToast(err, "Couldn't add the asset");
    }
  }

  const risky = selected && !selected.verified && (selected.riskLevel === "high" || selected.riskLevel === "critical");

  return (
    <Modal
      open={open}
      onClose={close}
      dismissible={!busy}
      size="lg"
      title={selected ? `Add ${selected.code}` : "Add an asset"}
      description={selected ? undefined : "Search by asset code (USDC) or issuer domain (circle.com)."}
      footer={
        selected && (
          <>
            <Button variant="ghost" onClick={() => setSelected(null)} disabled={busy}>
              Back
            </Button>
            <Button onClick={() => void add(selected)} loading={busy}>
              {phaseLabel(phase, "Add trustline")}
            </Button>
          </>
        )
      }
    >
      {selected ? (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-fg">
            Issued by <span className="font-medium">{selected.domain ?? "an issuer without a home domain"}</span>
          </p>
          <p className="break-all font-mono text-xs text-fg-muted">{selected.issuer}</p>
          <p className="rounded-lg bg-info-soft px-3 py-2 text-info">
            Adding a trustline locks 0.5 XLM as a reserve. You get it back when you remove the trustline.
          </p>
          {risky && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger">
              This asset isn&apos;t verified and looks risky. Scammers issue lookalike assets; only continue if you trust this issuer.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Input label="Search assets" placeholder="USDC or circle.com" value={input} onChange={(e) => setInput(e.target.value)} autoFocus />
          <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">{searching ? "Results" : "Verified assets"}</p>
          {loading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : error ? (
            <p className="text-sm text-danger">{describeError(error)}</p>
          ) : choices.length === 0 ? (
            <p className="py-4 text-center text-sm text-fg-muted">No assets found.</p>
          ) : (
            <ul aria-label="Asset choices" className="max-h-80 divide-y divide-border overflow-y-auto">
              {choices.map((choice) => (
                <ChoiceRow
                  key={`${choice.code}:${choice.issuer}`}
                  choice={choice}
                  held={held.has(`${choice.code}:${choice.issuer}`)}
                  onSelect={() => setSelected(choice)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
