import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultExportRange, downloadTextFile, exportFileName, exportRangeQuery, toDayString, validateExportRange } from "./export";

afterEach(() => vi.restoreAllMocks());

describe("export range", () => {
  it("defaults to the last 365 days", () => {
    const now = new Date(2026, 5, 15, 12);
    expect(defaultExportRange(now)).toEqual({ from: toDayString(new Date(2025, 5, 15, 12)), to: "2026-06-15" });
  });

  it("validates order, presence and the one-year cap", () => {
    expect(validateExportRange("", "2026-01-01")).toBe("Choose a start and end date.");
    expect(validateExportRange("2026-02-01", "2026-01-01")).toBe("The start date must be before the end date.");
    expect(validateExportRange("2024-01-01", "2026-01-01")).toBe("Exports can cover at most one year.");
    expect(validateExportRange("2025-01-01", "2025-12-31")).toBeNull();
  });

  it("sends whole local days and never a future end", () => {
    const now = new Date(2026, 0, 10, 8);
    const q = exportRangeQuery("2026-01-01", "2026-01-31", now);
    expect(q.from).toBe(new Date(2026, 0, 1).toISOString());
    expect(q.to).toBe(now.toISOString());
    expect(exportRangeQuery("2025-01-01", "2025-01-31", now).to).toBe(new Date(2025, 0, 31, 23, 59, 59, 999).toISOString());
  });

  it("names files after the account and range", () => {
    expect(exportFileName("GBRPYHIL2CI3", "2026-01-01", "2026-02-01")).toBe("globewallet-GBRPYH-2026-01-01_2026-02-01.csv");
  });
});

describe("downloadTextFile", () => {
  it("clicks a temporary link with the file name", () => {
    const createObjectURL = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadTextFile("a.csv", "x,y\n");
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(click.mock.contexts[0]).toHaveProperty("download", "a.csv");
  });
});
