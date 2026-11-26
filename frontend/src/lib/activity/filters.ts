import type { PaymentHistoryItem } from "@/lib/api/endpoints/account";
import { paymentDirection } from "./operations";

/**
 * Client-side filters for the payments feed. The backend's
 * /account/:id/payments route pages through Horizon without filters, so the
 * list filters each loaded page and keeps fetching while it scrolls.
 */

export type ActivityTypeFilter = "all" | "payment" | "path_payment" | "account";
export type DirectionFilter = "all" | "in" | "out" | "self";

export interface ActivityFilters {
  type: ActivityTypeFilter;
  direction: DirectionFilter;
  /** "all", "XLM" or "CODE:ISSUER". */
  asset: string;
  /** Inclusive start day, YYYY-MM-DD (local time). */
  from: string;
  /** Inclusive end day, YYYY-MM-DD (local time). */
  to: string;
}

export const DEFAULT_FILTERS: ActivityFilters = { type: "all", direction: "all", asset: "all", from: "", to: "" };

const TYPES: readonly ActivityTypeFilter[] = ["all", "payment", "path_payment", "account"];
const DIRECTIONS: readonly DirectionFilter[] = ["all", "in", "out", "self"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Asset id of a payments-feed record: "XLM", "CODE:ISSUER", or null when it carries none. */
export function paymentAssetId(item: PaymentHistoryItem): string | null {
  if (item.assetType === "native") return "XLM";
  if (item.assetCode && item.assetIssuer) return `${item.assetCode}:${item.assetIssuer}`;
  return null;
}

function typeOf(item: PaymentHistoryItem): Exclude<ActivityTypeFilter, "all"> {
  if (item.type === "payment") return "payment";
  if (item.type.startsWith("path_payment")) return "path_payment";
  return "account";
}

/** Local-day bounds in ms: [start of `from`, end of `to`]. */
function dayBounds(filters: ActivityFilters): { start: number; end: number } {
  const start = DAY.test(filters.from) ? new Date(`${filters.from}T00:00:00`).getTime() : -Infinity;
  const end = DAY.test(filters.to) ? new Date(`${filters.to}T23:59:59.999`).getTime() : Infinity;
  return { start, end };
}

export function matchesFilters(item: PaymentHistoryItem, filters: ActivityFilters, account: string): boolean {
  if (filters.type !== "all" && typeOf(item) !== filters.type) return false;
  if (filters.direction !== "all" && paymentDirection(item, account) !== filters.direction) return false;
  if (filters.asset !== "all" && paymentAssetId(item) !== filters.asset) return false;
  const { start, end } = dayBounds(filters);
  if (start !== -Infinity || end !== Infinity) {
    const at = new Date(item.createdAt).getTime();
    if (!(at >= start && at <= end)) return false;
  }
  return true;
}

export function filterPayments(items: PaymentHistoryItem[], filters: ActivityFilters, account: string) {
  return items.filter((item) => matchesFilters(item, filters, account));
}

export function hasActiveFilters(filters: ActivityFilters): boolean {
  return (
    filters.type !== "all" || filters.direction !== "all" || filters.asset !== "all" || Boolean(filters.from) || Boolean(filters.to)
  );
}

/** The feed is newest first, so once a page is older than `from` nothing further can match. */
export function isPastDateRange(item: PaymentHistoryItem | undefined, filters: ActivityFilters): boolean {
  if (!item || !DAY.test(filters.from)) return false;
  return new Date(item.createdAt).getTime() < dayBounds(filters).start;
}

/** Distinct asset ids seen in the loaded items, XLM first, for the asset dropdown. */
export function assetOptions(items: PaymentHistoryItem[]): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    const id = paymentAssetId(item);
    if (id) ids.add(id);
  }
  return [...ids].sort((a, b) => (a === "XLM" ? -1 : b === "XLM" ? 1 : a.localeCompare(b)));
}

/** Read filters from the URL (?type=&direction=&asset=&from=&to=), ignoring junk values. */
export function filtersFromSearchParams(params: URLSearchParams): ActivityFilters {
  const type = params.get("type") as ActivityTypeFilter | null;
  const direction = params.get("direction") as DirectionFilter | null;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  return {
    type: type && TYPES.includes(type) ? type : "all",
    direction: direction && DIRECTIONS.includes(direction) ? direction : "all",
    asset: params.get("asset") || "all",
    from: DAY.test(from) ? from : "",
    to: DAY.test(to) ? to : "",
  };
}

/** Only non-default values go in the URL. */
export function filtersToSearchParams(filters: ActivityFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.type !== "all") params.set("type", filters.type);
  if (filters.direction !== "all") params.set("direction", filters.direction);
  if (filters.asset !== "all") params.set("asset", filters.asset);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params;
}
