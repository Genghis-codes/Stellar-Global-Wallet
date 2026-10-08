import { InProcessAccountLock } from "../../src/services/locks/accountLock";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("InProcessAccountLock", () => {
  it("runs same-key calls one at a time, in arrival order", async () => {
    const lock = new InProcessAccountLock();
    const events: string[] = [];

    const task = (name: string, delayMs: number) =>
      lock.withLock("account-1", async () => {
        events.push(`${name}:start`);
        await sleep(delayMs);
        events.push(`${name}:end`);
        return name;
      });

    const results = await Promise.all([task("a", 30), task("b", 5), task("c", 5)]);

    expect(results).toEqual(["a", "b", "c"]);
    expect(events).toEqual([
      "a:start",
      "a:end",
      "b:start",
      "b:end",
      "c:start",
      "c:end",
    ]);
  });

  it("does not serialize calls for different keys", async () => {
    const lock = new InProcessAccountLock();
    const events: string[] = [];

    const task = (key: string, delayMs: number) =>
      lock.withLock(key, async () => {
        events.push(`${key}:start`);
        await sleep(delayMs);
        events.push(`${key}:end`);
      });

    // "slow" holds its lock for longer than "fast" takes entirely — if
    // keys were (incorrectly) sharing one queue, "fast:start" would only
    // appear after "slow:end".
    await Promise.all([task("slow", 30), task("fast", 5)]);

    expect(events.indexOf("fast:start")).toBeLessThan(events.indexOf("slow:end"));
  });

  it("a rejected task does not wedge the queue for later callers on the same key", async () => {
    const lock = new InProcessAccountLock();

    await expect(
      lock.withLock("account-1", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    // If the failure had wedged the internal chain, this would hang/timeout.
    const result = await lock.withLock("account-1", async () => "recovered");
    expect(result).toBe("recovered");
  });
});
