import { describe, expect, it } from "vitest";
import { chartGeometry, nearestIndex } from "./chartGeometry";

describe("chartGeometry", () => {
  it("scales points into the box and breaks the line at gaps", () => {
    const g = chartGeometry(
      [
        { t: 0, value: 1 },
        { t: 1, value: 3 },
        { t: 2, value: null },
        { t: 3, value: 2 },
      ],
      100,
      50,
      0
    );
    expect(g.min).toBe(1);
    expect(g.max).toBe(3);
    expect(g.path).toBe("M0.00,50.00L33.33,0.00M100.00,25.00");
    expect(g.coords).toHaveLength(3);
  });

  it("centres a flat series and handles empty input", () => {
    const flat = chartGeometry(
      [
        { t: 0, value: 5 },
        { t: 1, value: 5 },
      ],
      10,
      20,
      0
    );
    expect(flat.coords.map((c) => c.y)).toEqual([10, 10]);
    expect(chartGeometry([{ t: 0, value: null }], 10, 10).path).toBe("");
  });

  it("finds the nearest point", () => {
    expect(nearestIndex([{ x: 0 }, { x: 10 }, { x: 20 }], 14)).toBe(1);
    expect(nearestIndex([{ x: 0 }, { x: 10 }, { x: 20 }], 16)).toBe(2);
  });
});
