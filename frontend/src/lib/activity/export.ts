/**
 * CSV statement export helpers (GET /account/:id/transactions/export.csv).
 * The backend takes ISO-8601 `from`/`to`, defaults to the last 365 days and
 * rejects ranges over one year (EXPORT_RANGE_TOO_LARGE).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Matches backend MAX_EXPORT_RANGE_MS (366 days, leap years included). */
export const MAX_EXPORT_RANGE_DAYS = 366;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD for a Date, in local time. */
export function toDayString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function defaultExportRange(now: Date = new Date()): { from: string; to: string } {
  return { from: toDayString(new Date(now.getTime() - 365 * DAY_MS)), to: toDayString(now) };
}

/** Validation message for a day range, or null when it is fine to send. */
export function validateExportRange(from: string, to: string): string | null {
  if (!DAY.test(from) || !DAY.test(to)) return "Choose a start and end date.";
  const start = new Date(`${from}T00:00:00`).getTime();
  const end = new Date(`${to}T23:59:59.999`).getTime();
  if (start > end) return "The start date must be before the end date.";
  if (end - start > MAX_EXPORT_RANGE_DAYS * DAY_MS) return "Exports can cover at most one year.";
  return null;
}

/** Local-day range as the ISO timestamps the backend expects (end of day inclusive). */
export function exportRangeQuery(from: string, to: string, now: Date = new Date()): { from: string; to: string } {
  const end = new Date(`${to}T23:59:59.999`);
  return {
    from: new Date(`${from}T00:00:00`).toISOString(),
    // The backend measures the range against `to`; don't ask for the future.
    to: (end.getTime() > now.getTime() ? now : end).toISOString(),
  };
}

export function exportFileName(account: string, from: string, to: string): string {
  return `globewallet-${account.slice(0, 6)}-${from}_${to}.csv`;
}

/** Save text as a file through a temporary object URL. */
export function downloadTextFile(fileName: string, text: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
