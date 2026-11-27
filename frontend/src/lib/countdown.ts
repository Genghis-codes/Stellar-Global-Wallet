/**
 * Countdown helpers for timelocked contract actions (spend-limit increases,
 * recovery, guardian changes, upgrades). Framework-free; `useCountdown`
 * in hooks/ ticks them.
 */

/** Average Stellar ledger close time, the figure the backend uses for ETAs. */
export const SECONDS_PER_LEDGER = 5;

/** Milliseconds until `target`, floored at 0. Invalid dates count as elapsed. */
export function msUntil(target: string | number | Date, now: number = Date.now()): number {
  const time = target instanceof Date ? target.getTime() : typeof target === "number" ? target : Date.parse(target);
  if (Number.isNaN(time)) return 0;
  return Math.max(0, time - now);
}

/** Approximate wall-clock duration of `ledgers` ledgers. */
export function ledgersToMs(ledgers: number): number {
  return Math.max(0, ledgers) * SECONDS_PER_LEDGER * 1000;
}

/**
 * Compact remaining time: "2d 3h", "3h 05m", "4m 09s", "9s". The two most
 * significant units are shown; "0s" when elapsed.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}

/** Long form for screen readers: "2 days, 3 hours". */
export function describeDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const parts: Array<[number, string]> = [
    [Math.floor(total / 86_400), "day"],
    [Math.floor((total % 86_400) / 3600), "hour"],
    [Math.floor((total % 3600) / 60), "minute"],
    [total % 60, "second"],
  ];
  const shown = parts.filter(([n]) => n > 0).slice(0, 2);
  if (shown.length === 0) return "less than a second";
  return shown.map(([n, unit]) => `${n} ${unit}${n === 1 ? "" : "s"}`).join(", ");
}
