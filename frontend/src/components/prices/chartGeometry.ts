/** Pure geometry for the price chart: scales points into an SVG box, breaking the line at gaps. */

export interface ChartPoint {
  t: number;
  value: number | null;
}

export interface ChartGeometry {
  /** SVG path ("M…L…"), with a new "M" after each gap. Empty when there is nothing to draw. */
  path: string;
  min: number;
  max: number;
  /** x/y for every point with a value, in input order. */
  coords: { x: number; y: number; t: number; value: number }[];
}

export function chartGeometry(points: ChartPoint[], width: number, height: number, padding = 4): ChartGeometry {
  const valued = points.filter((p): p is { t: number; value: number } => p.value !== null && Number.isFinite(p.value));
  if (valued.length === 0) return { path: "", min: 0, max: 0, coords: [] };

  const values = valued.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const t0 = points[0]!.t;
  const t1 = points[points.length - 1]!.t;
  const spanT = t1 - t0 || 1;
  const spanV = max - min;
  const x = (t: number) => padding + ((t - t0) / spanT) * (width - padding * 2);
  // A flat series sits in the middle rather than on an edge.
  const y = (v: number) => (spanV === 0 ? height / 2 : padding + (1 - (v - min) / spanV) * (height - padding * 2));

  let path = "";
  let penDown = false;
  const coords: ChartGeometry["coords"] = [];
  for (const point of points) {
    if (point.value === null || !Number.isFinite(point.value)) {
      penDown = false;
      continue;
    }
    const px = x(point.t);
    const py = y(point.value);
    coords.push({ x: px, y: py, t: point.t, value: point.value });
    path += `${penDown ? "L" : "M"}${px.toFixed(2)},${py.toFixed(2)}`;
    penDown = true;
  }
  return { path, min, max, coords };
}

/** Index of the coordinate closest to `x` (coords are sorted by x). */
export function nearestIndex(coords: { x: number }[], x: number): number {
  let best = 0;
  for (let i = 1; i < coords.length; i++) {
    if (Math.abs(coords[i]!.x - x) < Math.abs(coords[best]!.x - x)) best = i;
  }
  return best;
}
