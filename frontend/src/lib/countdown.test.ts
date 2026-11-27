import { describe, expect, it } from "vitest";
import { describeDuration, formatDuration, ledgersToMs, msUntil } from "./countdown";

const NOW = Date.parse("2026-11-26T12:00:00.000Z");

describe("msUntil", () => {
  it("accepts ISO strings, epoch ms and dates", () => {
    expect(msUntil("2026-11-26T12:01:00.000Z", NOW)).toBe(60_000);
    expect(msUntil(NOW + 5000, NOW)).toBe(5000);
    expect(msUntil(new Date(NOW + 1), NOW)).toBe(1);
  });

  it("floors at zero and treats invalid dates as elapsed", () => {
    expect(msUntil("2026-11-26T11:00:00.000Z", NOW)).toBe(0);
    expect(msUntil("not a date", NOW)).toBe(0);
  });
});

describe("ledgersToMs", () => {
  it("uses ~5 s per ledger", () => {
    expect(ledgersToMs(12)).toBe(60_000);
    expect(ledgersToMs(-3)).toBe(0);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0s"],
    [9_400, "9s"],
    [249_000, "4m 09s"],
    [3 * 3600_000 + 5 * 60_000, "3h 05m"],
    [2 * 86_400_000 + 3 * 3600_000 + 59_000, "2d 3h"],
    [-10, "0s"],
  ])("%d ms → %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe("describeDuration", () => {
  it("spells out the two largest units", () => {
    expect(describeDuration(86_400_000 + 7_200_000 + 1000)).toBe("1 day, 2 hours");
    expect(describeDuration(61_000)).toBe("1 minute, 1 second");
    expect(describeDuration(0)).toBe("less than a second");
  });
});
