import type { ActivityItem, PaymentHistoryItem } from "@/lib/api/endpoints/account";
import type { HistoryAsset, HistoryItem } from "@/lib/api/endpoints/transactions";
import { truncateAddress } from "@/lib/format";

/**
 * Human-readable rendering of Stellar operations for the activity list and
 * the transaction detail screen. Pure functions: they take the backend's
 * shapes (HistoryItem from /transactions/:hash, PaymentHistoryItem from
 * /account/:id/payments, ActivityItem from /account/:id/activity) and return
 * the words and numbers to show.
 */

export type OperationKind =
  | "sent"
  | "received"
  | "self"
  | "swap"
  | "account_created"
  | "account_funded"
  | "trustline_added"
  | "trustline_removed"
  | "trustline_updated"
  | "claimable_created"
  | "claimable_claimed"
  | "options"
  | "contract"
  | "offer"
  | "merge"
  | "other";

export interface RenderedOperation {
  kind: OperationKind;
  /** Short headline: "Received", "Added trustline", "Changed account settings". */
  title: string;
  /** Secondary line, e.g. "from GABC…WXYZ" or "USDC → XLM"; null when there is nothing to add. */
  description: string | null;
  /** Decimal string; null when the operation moves no single amount. */
  amount: string | null;
  assetCode: string | null;
  /** "+" for incoming, "-" for outgoing, null when neither. */
  sign: "+" | "-" | null;
  counterparty: string | null;
  failed: boolean;
}

const OPERATION_LABELS: Record<string, string> = {
  create_account: "Create account",
  payment: "Payment",
  path_payment_strict_receive: "Path payment (strict receive)",
  path_payment_strict_send: "Path payment (strict send)",
  path_payment: "Path payment",
  manage_sell_offer: "Sell offer",
  manage_buy_offer: "Buy offer",
  create_passive_sell_offer: "Passive sell offer",
  manage_offer: "Offer",
  set_options: "Set options",
  change_trust: "Change trustline",
  allow_trust: "Allow trust",
  set_trust_line_flags: "Set trustline flags",
  account_merge: "Merge account",
  inflation: "Inflation",
  manage_data: "Manage data",
  bump_sequence: "Bump sequence",
  create_claimable_balance: "Create claimable balance",
  claim_claimable_balance: "Claim claimable balance",
  clawback_claimable_balance: "Claw back claimable balance",
  begin_sponsoring_future_reserves: "Begin sponsoring reserves",
  end_sponsoring_future_reserves: "End sponsoring reserves",
  revoke_sponsorship: "Revoke sponsorship",
  clawback: "Clawback",
  liquidity_pool_deposit: "Liquidity pool deposit",
  liquidity_pool_withdraw: "Liquidity pool withdrawal",
  invoke_host_function: "Contract call",
  extend_footprint_ttl: "Extend contract storage",
  restore_footprint: "Restore contract storage",
};

/** Display name for a raw Horizon operation type ("set_options" → "Set options"). */
export function operationTypeLabel(type: string): string {
  const known = OPERATION_LABELS[type];
  if (known) return known;
  const words = type.replace(/_/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Operation";
}

const short = (address: string) => truncateAddress(address, 4, 4);

/** Asset code to display; liquidity-pool shares read as "pool shares". */
function codeOf(asset: HistoryAsset | null): string | null {
  if (!asset) return null;
  return asset.type === "liquidity_pool_shares" ? "pool shares" : asset.code;
}

/** "CODE:ISSUER" / "native" (claimable balances) → code. */
export function codeFromCanonical(asset: unknown): string | null {
  if (typeof asset !== "string" || asset.length === 0) return null;
  if (asset === "native" || asset === "XLM") return "XLM";
  return asset.split(":")[0] ?? null;
}

const isZero = (amount: string | null) => amount !== null && /^0*(\.0*)?$/.test(amount);

function base(partial: Partial<RenderedOperation> & Pick<RenderedOperation, "kind" | "title">): RenderedOperation {
  return {
    description: null,
    amount: null,
    assetCode: null,
    sign: null,
    counterparty: null,
    failed: false,
    ...partial,
  };
}

/** A decoded operation (HistoryItem) as one activity line. */
export function renderHistoryItem(item: HistoryItem): RenderedOperation {
  const failed = !item.successful;
  const code = codeOf(item.asset);
  const cp = item.counterparty;

  switch (item.type) {
    case "payment": {
      const isPath = item.operationType.startsWith("path_payment");
      const via =
        isPath && item.sourceAsset && item.asset && item.sourceAsset.id !== item.asset.id
          ? ` (${codeOf(item.sourceAsset)} → ${codeOf(item.asset)})`
          : "";
      if (item.direction === "in") {
        return base({
          kind: "received",
          title: "Received",
          description: `${cp ? `from ${short(cp)}` : "Incoming payment"}${via}`,
          amount: item.amount,
          assetCode: code,
          sign: "+",
          counterparty: cp,
          failed,
        });
      }
      if (item.direction === "out") {
        return base({
          kind: "sent",
          title: "Sent",
          description: `${cp ? `to ${short(cp)}` : "Outgoing payment"}${via}`,
          amount: item.amount,
          assetCode: code,
          sign: "-",
          counterparty: cp,
          failed,
        });
      }
      return base({ kind: "self", title: "Payment to self", amount: item.amount, assetCode: code, failed });
    }

    case "swap":
      return base({
        kind: "swap",
        title: "Swapped",
        description: `${item.sourceAmount ?? "?"} ${codeOf(item.sourceAsset) ?? ""} → ${codeOf(item.asset) ?? ""}`.trim(),
        amount: item.amount,
        assetCode: code,
        sign: "+",
        failed,
      });

    case "account_created":
      return item.direction === "in"
        ? base({
            kind: "account_funded",
            title: "Account funded",
            description: cp ? `by ${short(cp)}` : null,
            amount: item.amount,
            assetCode: "XLM",
            sign: "+",
            counterparty: cp,
            failed,
          })
        : base({
            kind: "account_created",
            title: "Created account",
            description: cp ? short(cp) : null,
            amount: item.amount,
            assetCode: "XLM",
            sign: "-",
            counterparty: cp,
            failed,
          });

    case "trustline": {
      if (isZero(item.trustlineLimit)) {
        return base({ kind: "trustline_removed", title: "Removed trustline", description: code, assetCode: code, failed });
      }
      return base({
        kind: "trustline_added",
        title: "Added trustline",
        description: code,
        assetCode: code,
        counterparty: cp,
        failed,
      });
    }

    case "contract": {
      const amount = item.amount;
      const sign = amount ? (item.direction === "in" ? "+" : item.direction === "out" ? "-" : null) : null;
      return base({
        kind: "contract",
        title: "Contract call",
        description: cp ? `${short(cp)}` : null,
        amount,
        assetCode: amount ? code : null,
        sign,
        counterparty: cp,
        failed,
      });
    }

    default:
      return renderOtherOperation(item, failed);
  }
}

function renderOtherOperation(item: HistoryItem, failed: boolean): RenderedOperation {
  const code = codeOf(item.asset);
  const cp = item.counterparty;
  switch (item.operationType) {
    case "set_options":
      return base({ kind: "options", title: "Changed account settings", description: "Signers, thresholds or flags", failed });
    case "create_claimable_balance":
      return base({
        kind: "claimable_created",
        title: "Created claimable balance",
        amount: item.amount,
        assetCode: code,
        sign: item.direction === "self" ? "-" : null,
        counterparty: cp,
        failed,
      });
    case "claim_claimable_balance":
      return base({ kind: "claimable_claimed", title: "Claimed balance", failed });
    case "account_merge":
      return item.direction === "in"
        ? base({ kind: "merge", title: "Account merged in", description: cp ? `from ${short(cp)}` : null, counterparty: cp, failed })
        : base({ kind: "merge", title: "Merged account", description: cp ? `into ${short(cp)}` : null, counterparty: cp, failed });
    case "manage_sell_offer":
    case "manage_buy_offer":
    case "create_passive_sell_offer":
      return base({ kind: "offer", title: operationTypeLabel(item.operationType), amount: item.amount, assetCode: code, failed });
    default:
      return base({
        kind: "other",
        title: operationTypeLabel(item.operationType),
        description: cp ? `by ${short(cp)}` : null,
        amount: item.amount,
        assetCode: item.amount ? code : null,
        counterparty: cp,
        failed,
      });
  }
}

/** Direction of a payments-feed record relative to `account`. */
export function paymentDirection(item: PaymentHistoryItem, account: string): "in" | "out" | "self" {
  if (item.from === account && item.to === account) return "self";
  if (item.from === account) return "out";
  if (item.to === account) return "in";
  return "self";
}

function paymentCode(item: PaymentHistoryItem): string | null {
  if (item.assetType === "native") return "XLM";
  return item.assetCode ?? null;
}

/** A /payments feed record (payments, path payments, create/merge account). */
export function renderPayment(item: PaymentHistoryItem, account: string): RenderedOperation {
  const direction = paymentDirection(item, account);
  const code = paymentCode(item);

  switch (item.type) {
    case "create_account":
      return base({ kind: "account_created", title: direction === "in" ? "Account funded" : "Create account" });
    case "account_merge":
      return base({ kind: "merge", title: "Account merge" });
    default: {
      const label = item.type.startsWith("path_payment") ? " (path payment)" : "";
      if (direction === "in") {
        return base({
          kind: "received",
          title: "Received",
          description: item.from ? `from ${short(item.from)}${label}` : null,
          amount: item.amount ?? null,
          assetCode: code,
          sign: "+",
          counterparty: item.from ?? null,
        });
      }
      if (direction === "out") {
        return base({
          kind: "sent",
          title: "Sent",
          description: item.to ? `to ${short(item.to)}${label}` : null,
          amount: item.amount ?? null,
          assetCode: code,
          sign: "-",
          counterparty: item.to ?? null,
        });
      }
      if (item.type !== "payment" && !label) {
        return base({ kind: "other", title: operationTypeLabel(item.type), amount: item.amount ?? null, assetCode: code });
      }
      return base({ kind: "self", title: "Payment to self", amount: item.amount ?? null, assetCode: code });
    }
  }
}

const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/** A unified /activity feed item (payment reference, contract event or claimable balance). */
export function renderActivityItem(item: ActivityItem): RenderedOperation {
  const d = item.details;
  if (item.source === "claimable_balance") {
    if (item.type === "create_claimable_balance") {
      return base({
        kind: "claimable_created",
        title: "Claimable balance created",
        description: str(d.sourceAccount) ? `by ${short(str(d.sourceAccount)!)}` : null,
        amount: str(d.amount),
        assetCode: codeFromCanonical(d.asset),
        counterparty: str(d.sourceAccount),
      });
    }
    return base({
      kind: "claimable_claimed",
      title: "Claimable balance claimed",
      description: str(d.claimant) ? `by ${short(str(d.claimant)!)}` : null,
      counterparty: str(d.claimant),
    });
  }
  if (item.source === "contract_event") {
    const topic = str(d.topic0);
    const contract = str(d.contractId);
    return base({
      kind: "contract",
      title: topic ? `Contract event: ${topic}` : "Contract event",
      description: contract ? short(contract) : null,
      counterparty: contract,
    });
  }
  return base({ kind: "other", title: operationTypeLabel(item.type) });
}
