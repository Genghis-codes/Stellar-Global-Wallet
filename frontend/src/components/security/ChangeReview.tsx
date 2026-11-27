import { AlertIcon } from "@/components/icons";
import type { SignerChangeResult } from "@/lib/multisig/thresholds";

export interface ChangeReviewProps {
  result: SignerChangeResult;
  /** Set when the user ticked "I understand" for the warnings. */
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
}

/** Lock-out problems (blocking) and risks (need an explicit acknowledgement) for a signer change. */
export function ChangeReview({ result, acknowledged, onAcknowledge }: ChangeReviewProps) {
  if (result.problems.length > 0) {
    return (
      <div role="alert" className="rounded-lg border border-danger bg-danger-soft p-3 text-sm text-danger">
        <p className="flex items-center gap-2 font-medium">
          <AlertIcon className="h-4 w-4" /> This change would lock the account out
        </p>
        <ul className="mt-2 list-disc pl-5">
          {result.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (result.warnings.length === 0) return null;
  return (
    <div className="rounded-lg border border-warning bg-warning-soft p-3 text-sm text-warning">
      <ul className="list-disc pl-5">
        {result.warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
      <label className="mt-2 flex items-center gap-2 text-fg">
        <input type="checkbox" checked={acknowledged} onChange={(event) => onAcknowledge(event.target.checked)} />
        I understand the risks
      </label>
    </div>
  );
}

/** Whether a reviewed change may go ahead. */
export function canProceed(result: SignerChangeResult, acknowledged: boolean): boolean {
  return result.problems.length === 0 && (result.warnings.length === 0 || acknowledged);
}
