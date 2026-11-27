"use client";

import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatFiat } from "@/lib/format";
import { chartGeometry, nearestIndex, type ChartPoint } from "./chartGeometry";

export interface PriceChartProps {
  points: ChartPoint[];
  currency?: string;
  /** Accessible name, e.g. "XLM price, last 7 days". */
  label: string;
  height?: number;
}

const WIDTH = 600;

function formatTime(t: number): string {
  return new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Lightweight single-series line chart (SVG, no chart library) with a
 * crosshair + tooltip on hover and arrow-key navigation, plus a hidden table
 * for screen readers.
 */
export function PriceChart({ points, currency = "USD", label, height = 160 }: PriceChartProps) {
  const geometry = useMemo(() => chartGeometry(points, WIDTH, height, 6), [points, height]);
  const [active, setActive] = useState<number | null>(null);
  const tableId = useId();

  if (geometry.coords.length < 2) {
    return <p className="py-10 text-center text-sm text-fg-muted">Not enough price data to draw a chart.</p>;
  }

  const point = active === null ? null : geometry.coords[active]!;

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    setActive(nearestIndex(geometry.coords, ((event.clientX - box.left) / box.width) * WIDTH));
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    const last = geometry.coords.length - 1;
    const current = active ?? last;
    const next =
      event.key === "ArrowLeft"
        ? Math.max(0, current - 1)
        : event.key === "ArrowRight"
        ? Math.min(last, current + 1)
        : event.key === "Home"
        ? 0
        : event.key === "End"
        ? last
        : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  }

  return (
    <figure className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
        className="h-40 w-full touch-none rounded-lg text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
        role="img"
        aria-label={`${label}. Low ${formatFiat(geometry.min, currency)}, high ${formatFiat(geometry.max, currency)}.`}
        aria-describedby={tableId}
        tabIndex={0}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        <path
          d={geometry.path}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {point && (
          <>
            <line
              x1={point.x}
              x2={point.x}
              y1={0}
              y2={height}
              className="text-border"
              stroke="currentColor"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={point.x}
              cy={point.y}
              r={4}
              fill="currentColor"
              className="stroke-surface"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>
      {point && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg border border-border bg-surface px-2 py-1 text-xs shadow"
          style={{ left: `${Math.min(90, Math.max(10, (point.x / WIDTH) * 100))}%` }}
        >
          <p className="font-medium text-fg">{formatFiat(point.value, currency)}</p>
          <p className="text-fg-muted">{formatTime(point.t)}</p>
        </div>
      )}
      <table id={tableId} className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Price</th>
          </tr>
        </thead>
        <tbody>
          {geometry.coords.map((c) => (
            <tr key={c.t}>
              <td>{formatTime(c.t)}</td>
              <td>{formatFiat(c.value, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
