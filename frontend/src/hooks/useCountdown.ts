"use client";

import { useEffect, useState } from "react";
import { msUntil } from "@/lib/countdown";

/** Milliseconds left until `target`, re-rendering every `intervalMs` until it elapses. */
export function useCountdown(target: string | number | Date | null | undefined, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  const remaining = target == null ? 0 : msUntil(target, now);

  useEffect(() => {
    if (target == null || remaining <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [target, remaining, intervalMs]);

  return remaining;
}
