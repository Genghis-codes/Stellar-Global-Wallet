"use client";

import { describeDuration, formatDuration } from "@/lib/countdown";
import { cn } from "@/lib/cn";
import { useCountdown } from "@/hooks/useCountdown";

export interface CountdownProps {
  /** ISO time, epoch ms or Date to count down to. */
  target: string | number | Date;
  /** Shown once the target time has passed. */
  doneLabel?: string;
  className?: string;
}

/** Live "3h 05m" countdown with a spelled-out label for screen readers. */
export function Countdown({ target, doneLabel = "now", className }: CountdownProps) {
  const remaining = useCountdown(target);
  const date = new Date(target);
  return (
    <time
      dateTime={Number.isNaN(date.getTime()) ? undefined : date.toISOString()}
      title={Number.isNaN(date.getTime()) ? undefined : date.toLocaleString()}
      aria-label={remaining > 0 ? describeDuration(remaining) : doneLabel}
      className={cn("tabular-nums", className)}
    >
      {remaining > 0 ? formatDuration(remaining) : doneLabel}
    </time>
  );
}
