import { FeeBumpTransaction, TransactionBuilder, type Memo, type Transaction } from "@stellar/stellar-sdk";

type Op = Transaction["operations"][number];
import type { PendingTx, PendingTxStatus } from "@/lib/api/endpoints/pendingTxs";

/** Same values as the Badge tones. */
export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

/** Badge tone and label for each pending-transaction status. */
export const PENDING_STATUS: Record<PendingTxStatus, { label: string; tone: StatusTone }> = {
  pending: { label: "Awaiting signatures", tone: "warning" },
  ready: { label: "Ready to submit", tone: "success" },
  submitted: { label: "Submitted", tone: "info" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Expired", tone: "danger" },
};

/** Statuses that still accept signatures. */
export function isOpen(tx: Pick<PendingTx, "status">): boolean {
  return tx.status === "pending" || tx.status === "ready";
}

export function hasSigned(tx: Pick<PendingTx, "collectedSigners">, account: string): boolean {
  return tx.collectedSigners.includes(account);
}

/** Collected weight as a 0–100 share of the required weight. */
export function signingProgress(tx: Pick<PendingTx, "collectedWeight" | "requiredWeight">): number {
  if (tx.requiredWeight <= 0) return 100;
  return Math.min(100, Math.round((tx.collectedWeight / tx.requiredWeight) * 100));
}

export interface OperationSummary {
  type: string;
  description: string;
  source?: string;
}

export interface TransactionSummary {
  source: string;
  fee: string;
  sequence: string;
  memo: string | null;
  operations: OperationSummary[];
  signatureCount: number;
}

function assetLabel(asset: { isNative(): boolean; getCode(): string }): string {
  return asset.isNative() ? "XLM" : asset.getCode();
}

function describeOperation(op: Op): string {
  switch (op.type) {
    case "payment":
      return `Pay ${op.amount} ${assetLabel(op.asset)} to ${op.destination}`;
    case "createAccount":
      return `Create ${op.destination} with ${op.startingBalance} XLM`;
    case "changeTrust":
      return "getCode" in op.line ? `Change trust in ${assetLabel(op.line)}` : "Change trust in a liquidity pool";
    case "accountMerge":
      return `Merge account into ${op.destination}`;
    case "setOptions": {
      const parts: string[] = [];
      if (op.signer && "ed25519PublicKey" in op.signer) {
        parts.push(
          op.signer.weight === 0
            ? `remove signer ${op.signer.ed25519PublicKey}`
            : `set signer ${op.signer.ed25519PublicKey} weight ${op.signer.weight}`,
        );
      }
      if (op.masterWeight !== undefined) parts.push(`master weight ${op.masterWeight}`);
      if (op.lowThreshold !== undefined) parts.push(`low threshold ${op.lowThreshold}`);
      if (op.medThreshold !== undefined) parts.push(`medium threshold ${op.medThreshold}`);
      if (op.highThreshold !== undefined) parts.push(`high threshold ${op.highThreshold}`);
      return parts.length ? `Set options: ${parts.join(", ")}` : "Set options";
    }
    default:
      return op.type.replace(/([A-Z])/g, " $1").replace(/^./, (c: string) => c.toUpperCase());
  }
}

function memoText(memo: Memo): string | null {
  const value = memo.value;
  if (memo.type === "none" || value === null) return null;
  if (typeof value === "string") return value;
  return memo.type === "text" ? new TextDecoder().decode(value) : Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Human-readable view of a classic transaction envelope, or null if it can't be parsed. */
export function summarizeTransaction(xdr: string, passphrase: string): TransactionSummary | null {
  try {
    const parsed = TransactionBuilder.fromXDR(xdr, passphrase);
    const tx = parsed instanceof FeeBumpTransaction ? parsed.innerTransaction : parsed;
    const memo = memoText(tx.memo);
    return {
      source: tx.source,
      fee: tx.fee,
      sequence: tx.sequence,
      memo,
      operations: tx.operations.map((op) => ({ type: op.type, description: describeOperation(op), source: op.source })),
      signatureCount: parsed.signatures.length,
    };
  } catch {
    return null;
  }
}
