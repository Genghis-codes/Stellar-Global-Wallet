import { describe, expect, it } from "vitest";
import {
  SPEND_LIMIT_INCREASE_DELAY_MS,
  classifySpendLimitChange,
  parseSpendLimitInput,
  pendingSpendLimitStore,
} from "./spendLimit";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const NOW = Date.parse("2026-11-26T12:00:00.000Z");

describe("classifySpendLimitChange", () => {
  it("mirrors the contract's decrease/increase rules", () => {
    expect(classifySpendLimitChange(100n, 50n)).toBe("decrease");
    expect(classifySpendLimitChange(0n, 50n)).toBe("decrease"); // unlimited → any cap
    expect(classifySpendLimitChange(100n, 150n)).toBe("increase");
    expect(classifySpendLimitChange(100n, 0n)).toBe("increase"); // cap → unlimited
    expect(classifySpendLimitChange(100n, 100n)).toBe("noop");
    expect(classifySpendLimitChange(0n, 0n)).toBe("noop");
  });
});

describe("parseSpendLimitInput", () => {
  const current = { limit: "1000000000", spent: "300000000" }; // 100 limit, 30 spent

  it("converts a decimal to stroops and classifies it", () => {
    expect(parseSpendLimitInput("250.5", current)).toEqual({
      limit: "250.5",
      stroops: 2_505_000_000n,
      change: "increase",
    });
    expect(parseSpendLimitInput("50", current)).toMatchObject({ change: "decrease" });
  });

  it("rejects zero, junk and too many decimals", () => {
    for (const raw of ["0", "", "abc", "1.12345678", "-5"]) {
      expect(parseSpendLimitInput(raw, current)).toHaveProperty("error");
    }
  });

  it("rejects a lower limit than what was already spent", () => {
    const result = parseSpendLimitInput("20", current);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("30");
  });

  it("treats removing the limit as an increase", () => {
    expect(parseSpendLimitInput("ignored", current, true)).toEqual({ limit: "0", stroops: 0n, change: "increase" });
  });
});

describe("pendingSpendLimitStore", () => {
  function memoryStorage(): Storage {
    const map = new Map<string, string>();
    return {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (key) => map.get(key) ?? null,
      key: (index) => [...map.keys()][index] ?? null,
      removeItem: (key) => void map.delete(key),
      setItem: (key, value) => void map.set(key, value),
    };
  }

  const pending = {
    assetCode: "USDC",
    limit: "2000000000",
    previousLimit: "1000000000",
    effectiveAt: new Date(NOW + SPEND_LIMIT_INCREASE_DELAY_MS).toISOString(),
  };

  it("saves, replaces and removes per asset", () => {
    const storage = memoryStorage();
    const persistent = pendingSpendLimitStore(() => storage);
    persistent.save(G, pending);
    persistent.save(G, { ...pending, limit: "3000000000" });
    expect(persistent.list(G, NOW)).toEqual([{ ...pending, limit: "3000000000" }]);
    persistent.remove(G, "USDC");
    expect(persistent.list(G, NOW)).toEqual([]);
    expect(storage.length).toBe(0);
  });

  it("drops matured entries", () => {
    const storage = memoryStorage();
    const store = pendingSpendLimitStore(() => storage);
    store.save(G, pending);
    expect(store.list(G, NOW + SPEND_LIMIT_INCREASE_DELAY_MS + 1)).toEqual([]);
    expect(storage.length).toBe(0);
  });

  it("survives broken or missing storage", () => {
    const storage = memoryStorage();
    storage.setItem(`gw.pendingSpendLimits.${G}`, "{not json");
    expect(pendingSpendLimitStore(() => storage).list(G, NOW)).toEqual([]);
    const none = pendingSpendLimitStore(() => undefined);
    none.save(G, pending);
    expect(none.list(G, NOW)).toEqual([]);
  });
});
