import type { TimelineStep } from "@/lib/contract/recovery";
import { cn } from "@/lib/cn";

const DOT: Record<TimelineStep["status"], string> = {
  done: "bg-success border-success",
  current: "bg-primary border-primary ring-4 ring-primary/20",
  upcoming: "bg-surface border-border",
};

const STATUS_TEXT: Record<TimelineStep["status"], string> = {
  done: "completed",
  current: "current step",
  upcoming: "upcoming",
};

/** Vertical timeline of the social-recovery lifecycle. */
export function RecoveryTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="relative flex flex-col gap-5" aria-label="Recovery progress">
      {steps.map((step, index) => (
        <li key={step.id} className="relative flex gap-4" aria-current={step.status === "current" ? "step" : undefined}>
          {index < steps.length - 1 && (
            <span
              aria-hidden
              className={cn(
                "absolute left-[7px] top-5 h-[calc(100%+0.25rem)] w-0.5",
                step.status === "done" ? "bg-success" : "bg-border",
              )}
            />
          )}
          <span aria-hidden className={cn("relative mt-1 h-4 w-4 shrink-0 rounded-full border-2", DOT[step.status])} />
          <div className="min-w-0">
            <p className={cn("text-sm font-medium", step.status === "upcoming" ? "text-fg-muted" : "text-fg")}>
              {step.title} <span className="sr-only">({STATUS_TEXT[step.status]})</span>
            </p>
            <p className="break-all text-sm text-fg-muted">{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
