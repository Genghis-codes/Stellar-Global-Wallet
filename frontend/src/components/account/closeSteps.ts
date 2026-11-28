import type { CloseAccountOperation } from "@/lib/api/endpoints/account";
import { codeFromCanonical } from "@/lib/activity/operations";
import { truncateAddress } from "@/lib/format";

const code = (asset?: string) => (asset ? codeFromCanonical(asset) ?? asset : "asset");

/** One close-account step in plain words. */
export function describeCloseStep(op: CloseAccountOperation): string {
  switch (op.type) {
    case "cancelOffer":
      return `Cancel open offer${op.offerId ? ` #${op.offerId}` : ""}${op.selling && op.buying ? ` (${code(op.selling)} → ${code(op.buying)})` : ""}`;
    case "revokeSponsorship":
      return `End sponsorship${op.sponsor ? ` from ${truncateAddress(op.sponsor)}` : ""}`;
    case "convertBalance":
      return `Convert ${op.amount ?? ""} ${code(op.asset)} to XLM${op.minXlm ? ` (at least ${op.minXlm} XLM)` : ""}`.replace(/\s+/g, " ");
    case "sendBalance":
      return `Send ${op.amount ?? ""} ${code(op.asset)} to ${op.destination ? truncateAddress(op.destination) : "the destination"}`.replace(/\s+/g, " ");
    case "removeTrustline":
      return `Remove the ${code(op.asset)} trustline`;
    case "removeSigner":
      return `Remove signer ${op.signer ? truncateAddress(op.signer) : ""}`.trim();
    case "removeData":
      return `Delete data entry "${op.name ?? ""}"`;
    case "accountMerge":
      return `Merge the account and send all remaining XLM to ${op.destination ? truncateAddress(op.destination) : "the destination"}`;
    default:
      return "Account change";
  }
}
