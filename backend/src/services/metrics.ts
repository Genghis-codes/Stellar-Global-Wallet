/**
 * Minimal in-process metrics registry: labelled counters and histograms,
 * rendered in the Prometheus text format at GET /api/v1/health/metrics.
 *
 * Deliberately dependency-free. Values are per process; a scraper sums
 * them across instances.
 */

type Labels = Record<string, string>;

function labelKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}="${String(labels[k]).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",");
}

export class Counter {
  private readonly values = new Map<string, number>();

  constructor(readonly name: string, readonly help: string) {}

  inc(labels: Labels = {}, by = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }

  get(labels: Labels = {}): number {
    return this.values.get(labelKey(labels)) ?? 0;
  }

  reset(): void {
    this.values.clear();
  }

  render(): string[] {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [key, value] of this.values) {
      lines.push(`${this.name}${key ? `{${key}}` : ""} ${value}`);
    }
    return lines;
  }
}

interface HistogramSeries {
  buckets: number[];
  sum: number;
  count: number;
}

export class Histogram {
  private readonly series = new Map<string, HistogramSeries>();

  constructor(
    readonly name: string,
    readonly help: string,
    private readonly bounds: number[] = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000, 30000]
  ) {}

  observe(value: number, labels: Labels = {}): void {
    const key = labelKey(labels);
    let s = this.series.get(key);
    if (!s) {
      s = { buckets: this.bounds.map(() => 0), sum: 0, count: 0 };
      this.series.set(key, s);
    }
    this.bounds.forEach((bound, i) => {
      if (value <= bound) s!.buckets[i] += 1;
    });
    s.sum += value;
    s.count += 1;
  }

  count(labels: Labels = {}): number {
    return this.series.get(labelKey(labels))?.count ?? 0;
  }

  reset(): void {
    this.series.clear();
  }

  render(): string[] {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [key, s] of this.series) {
      const prefix = key ? `${key},` : "";
      this.bounds.forEach((bound, i) => {
        lines.push(`${this.name}_bucket{${prefix}le="${bound}"} ${s.buckets[i]}`);
      });
      lines.push(`${this.name}_bucket{${prefix}le="+Inf"} ${s.count}`);
      lines.push(`${this.name}_sum${key ? `{${key}}` : ""} ${s.sum}`);
      lines.push(`${this.name}_count${key ? `{${key}}` : ""} ${s.count}`);
    }
    return lines;
  }
}

export class Gauge {
  private readonly values = new Map<string, number>();

  constructor(readonly name: string, readonly help: string) {}

  set(value: number, labels: Labels = {}): void {
    const key = labelKey(labels);
    this.values.set(key, value);
  }

  inc(labels: Labels = {}, by = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }

  dec(labels: Labels = {}, by = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) - by);
  }

  get(labels: Labels = {}): number {
    return this.values.get(labelKey(labels)) ?? 0;
  }

  reset(): void {
    this.values.clear();
  }

  render(): string[] {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const [key, value] of this.values) {
      lines.push(`${this.name}${key ? `{${key}}` : ""} ${value}`);
    }
    return lines;
  }
}

const registry: Array<Counter | Histogram | Gauge> = [];

function register<T extends Counter | Histogram | Gauge>(metric: T): T {
  registry.push(metric);
  return metric;
}

export const metrics = {
  /** #194 — signed envelopes refused at /wallet/submit, by reason. */
  submitRejected: register(
    new Counter("wallet_submit_rejected_total", "Signed envelopes refused before relay, by reason")
  ),
  /** #197 — time spent waiting for an account lock, by backend. */
  lockWaitMs: register(new Histogram("account_lock_wait_ms", "Milliseconds spent waiting to acquire an account lock")),
  /** #197 — acquisitions that found the lock already held at least once. */
  lockContended: register(new Counter("account_lock_contended_total", "Lock acquisitions that had to wait")),
  /** #197 — acquisitions that gave up (timeout) or could not reach the backend. */
  lockFailures: register(new Counter("account_lock_failures_total", "Lock acquisitions that failed, by reason")),
  /** #197 — leases that could not be extended because they had already expired or were taken over. */
  lockLeaseLost: register(new Counter("account_lock_lease_lost_total", "Lease extensions refused by the lock backend")),
  /** #196 — sponsored-reserve onboarding and reclamation. */
  sponsorships: register(new Counter("sponsored_reserves_total", "Sponsored reserve events, by event and kind")),

  /** #222 — Total transaction submissions by route and outcome (success, failure, pending). */
  submissionsTotal: register(
    new Counter("wallet_submissions_total", "Total transaction submissions by route and status")
  ),
  /** #222 — Duration of wallet submissions in milliseconds. */
  submissionDurationMs: register(
    new Histogram(
      "wallet_submission_duration_ms",
      "Transaction submission duration in milliseconds",
      [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000]
    )
  ),
  /** #222 — Total inbound HTTP requests by method, route, and status. */
  httpRequestsTotal: register(
    new Counter("http_requests_total", "Total HTTP requests by method, route, and status")
  ),
  /** #222 — Inbound HTTP request duration in milliseconds. */
  httpRequestDurationMs: register(
    new Histogram(
      "http_request_duration_ms",
      "HTTP request latency in milliseconds",
      [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
    )
  ),
  /** #222 — Activity feed indexer lag behind chain tip in ledgers. */
  indexerLagLedgers: register(
    new Gauge("activity_feed_indexer_lag_ledgers", "Activity feed indexer lag behind chain tip in ledgers")
  ),
  /** #222 — Activity feed indexer highest indexed ledger. */
  indexerCurrentLedger: register(
    new Gauge("activity_feed_indexer_current_ledger", "Activity feed indexer highest indexed ledger")
  ),
  /** #124 — Push notification delivery attempts, by platform and outcome. */
  pushAttempts: register(
    new Counter("push_attempts_total", "Push notification attempts by platform and outcome")
  ),
  /** #124 — Push notification payload size in bytes. */
  pushPayloadSizeBytes: register(
    new Histogram("push_payload_size_bytes", "Push notification payload size in bytes", [
      100, 250, 500, 1000, 2500, 5000, 10000, 20000,
    ])
  ),
  /** #124 — Push notification latency in milliseconds. */
  pushLatencyMs: register(
    new Histogram("push_latency_ms", "Push notification latency in milliseconds", [
      100, 250, 500, 1000, 2500, 5000, 10000, 30000,
    ])
  ),
  /** #124 — Invalid push tokens pruned by platform. */
  pushTokensPruned: register(
    new Counter("push_tokens_pruned_total", "Invalid push tokens pruned by platform")
  ),
  /** #124 — Expired push tokens (no device_not_registered, just old) by platform. */
  pushTokensExpired: register(
    new Counter("push_tokens_expired_total", "Expired push tokens by platform")
  ),
  /** #124 — Rate limit rejects for push sending. */
  pushRateLimited: register(
    new Counter("push_rate_limited_total", "Push notifications rejected due to rate limiting")
  ),
  /** #292 — Channel accounts currently leased out of the pool, by channel. */
  channelPoolInUse: register(
    new Gauge("channel_pool_in_use", "Channel accounts currently leased from the pool, by channel")
  ),
  /** #292 — Time spent waiting for a channel account lease, by outcome. */
  channelPoolLeaseWaitMs: register(
    new Histogram(
      "channel_pool_lease_wait_ms",
      "Milliseconds spent waiting to acquire a channel account lease",
      [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000]
    )
  ),
  /** #292 — Channel account top-ups from the treasury, by channel and outcome. */
  channelTopups: register(
    new Counter("channel_topups_total", "Channel account top-ups from the treasury, by channel and outcome")
  ),
  /** #292 — Fee-bump submissions that failed, by reason. */
  feeBumpFailures: register(
    new Counter("fee_bump_failures_total", "Fee-bump submissions that failed, by reason")
  ),
  /** #289 — Claimable balance notifications emitted, by kind and outcome. */
  claimableBalanceNotifications: register(
    new Counter(
      "claimable_balance_notifications_total",
      "Claimable balance notifications emitted, by kind and outcome"
    )
  ),
};

export function renderMetrics(): string {
  return registry.flatMap((m) => m.render()).join("\n") + "\n";
}

/** Test helper: zero every metric. */
export function resetMetrics(): void {
  registry.forEach((m) => m.reset());
}
