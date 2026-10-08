/**
 * Mutual-exclusion primitive keyed by Stellar account public key.
 *
 * `sendPayment` must run at most one in-flight submission per source
 * account at a time — see `InProcessAccountLock` and `RedisAccountLock`
 * for the two available backends and docs/concurrency.md for why both
 * exist and what each one does and does not guarantee.
 */
export interface AccountLock {
  withLock<T>(accountId: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * Serializes calls per account key within a single Node process using a
 * chain of promises — no external coordination, no network round-trip.
 *
 * Correct within one process, but each process has its own `tails` map:
 * running more than one instance of this service does NOT serialize
 * across instances. See docs/concurrency.md.
 */
export class InProcessAccountLock implements AccountLock {
  private readonly tails = new Map<string, Promise<void>>();

  async withLock<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
    const previousTail = this.tails.get(accountId) ?? Promise.resolve();

    // Resolves once it's this call's turn, regardless of whether the
    // previous holder threw — a failed submission must not wedge the
    // queue for every request behind it.
    const ready = previousTail.catch(() => {});

    let settleTail!: () => void;
    const tail = new Promise<void>((resolve) => {
      settleTail = resolve;
    });
    // Synchronous from `get` through `set` — no `await` in between — so
    // two calls arriving "simultaneously" can never both read the map
    // before either writes it.
    this.tails.set(accountId, tail);

    try {
      await ready;
      return await fn();
    } finally {
      settleTail();
      if (this.tails.get(accountId) === tail) {
        this.tails.delete(accountId);
      }
    }
  }
}
