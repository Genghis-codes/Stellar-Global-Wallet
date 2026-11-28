import type { PriceHistoryPoint } from "@/lib/api/endpoints/price";
import type { ChartPoint } from "./chartGeometry";

/** History points as chart points (null prices stay gaps). */
export function toChartPoints(points: PriceHistoryPoint[]): ChartPoint[] {
  return points.map((p) => {
    const value = p.price === null ? null : Number(p.price);
    return { t: Date.parse(p.t), value: value !== null && Number.isFinite(value) ? value : null };
  });
}

/** Percentage change from the first to the last priced point, or null with fewer than two. */
export function percentChange(points: ChartPoint[]): number | null {
  const valued = points.filter((p) => p.value !== null);
  if (valued.length < 2) return null;
  const first = valued[0]!.value!;
  const last = valued[valued.length - 1]!.value!;
  if (first === 0) return null;
  return ((last - first) / first) * 100;
}

export function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}
