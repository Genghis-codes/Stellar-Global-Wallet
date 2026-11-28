import { AlertIcon } from "@/components/icons";
import type { SendPrecheckWarning } from "@/lib/api/endpoints/wallet";
import { cn } from "@/lib/cn";

export interface PrecheckWarningsProps {
  warnings: SendPrecheckWarning[];
  className?: string;
}

const TITLES: Record<SendPrecheckWarning["code"], string> = {
  DESTINATION_IS_SOURCE: "Sending to yourself",
  SOURCE_NOT_FUNDED: "Your account isn't funded",
  DESTINATION_NOT_FUNDED: "Recipient account doesn't exist",
  DESTINATION_WILL_BE_CREATED: "This will create the recipient's account",
  NO_TRUSTLINE: "Recipient can't hold this asset",
  TRUSTLINE_NOT_AUTHORIZED: "Recipient isn't authorized for this asset",
  MEMO_REQUIRED: "Memo required",
  AMOUNT_EXCEEDS_SPENDABLE: "Not enough balance",
};

/** Warnings from POST /wallet/send/precheck; blocking ones first, in danger tone. */
export function PrecheckWarnings({ warnings, className }: PrecheckWarningsProps) {
  if (warnings.length === 0) return null;
  const sorted = [...warnings].sort((a, b) => Number(b.blocking) - Number(a.blocking));
  return (
    <ul className={cn("flex flex-col gap-2", className)} aria-label="Pre-send checks">
      {sorted.map((warning) => (
        <li
          key={warning.code}
          className={cn(
            "flex gap-2.5 rounded-lg p-3 text-sm",
            warning.blocking ? "bg-danger-soft text-danger" : warning.code === "DESTINATION_WILL_BE_CREATED" ? "bg-info-soft text-info" : "bg-warning-soft text-warning",
          )}
        >
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          {/* The alert role sits inside the <li> so the list keeps its listitem semantics. */}
          <div role={warning.blocking ? "alert" : undefined}>
            <p className="font-medium">{TITLES[warning.code] ?? warning.code}</p>
            <p className="mt-0.5 text-fg">{warning.message}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
