# Load Tests: Build/Submit Paths with Budget Gates

**Issue:** [#235](https://github.com/Genghis-codes/Stellar-Global-Wallet/issues/235)  
**Status:** Proposed  
**Difficulty:** Hard  
**Estimated size:** L — roughly 1–2 weeks

---

## Problem

Existing load tests cover read-only endpoints only. The build → sign → submit path has not been exercised under concurrent load, so bottlenecks involving database row locks and Stellar sequence-number contention are unknown until they surface in production.

---

## Threat / Failure Model

| Failure mode | Root cause | Observable symptom |
|---|---|---|
| Sequence number collision | Multiple submissions race on the same source account | Horizon `tx_bad_seq` errors |
| Lock contention | Concurrent builds hold row locks on the same wallet | High p95 latency or 5xx |
| Queue starvation | Sign/submit workers backlogged | Increasing error rate under sustained load |
| Resource exhaustion | DB connection pool saturated | Connection timeout errors |

---

## Proposed k6 Scenarios

All scenarios run against the quickstart environment (local or CI testnet). The quickstart setup is defined in `backend/.env.example`.

### Scenario A — Sequential happy path (baseline)

A single virtual user walks through the full flow once:

1. `POST /wallet/:id/transactions/build`
2. Sign the XDR (off-chain, using the test key fixture)
3. `POST /wallet/:id/transactions/submit`

Establishes baseline latency for a healthy, uncontended path.

### Scenario B — Concurrent build/submit (ramp)

```
stages:
  - duration: 30s, target: 10    # ramp up
  - duration: 2m,  target: 10    # sustained
  - duration: 30s, target: 50    # spike
  - duration: 2m,  target: 50    # sustained spike
  - duration: 30s, target: 0     # ramp down
```

Each VU:
1. Builds a transaction for a distinct wallet (pre-seeded test wallets, one per VU).
2. Signs the XDR.
3. Submits.

Distinct wallets eliminate cross-VU lock contention so this scenario isolates throughput limits from lock limits.

### Scenario C — Shared-wallet contention

Same flow as Scenario B but all VUs share a single wallet ID. This directly exercises row-lock contention and sequence-number management. Expected to surface lock wait times and `tx_bad_seq` errors; use this to set the floor for acceptable concurrency on a single wallet.

### Scenario D — Sustained error rate

Run Scenario B at 50 VUs for 10 minutes. Monitors for error rate drift over time (memory leaks, connection pool exhaustion).

### Scenario E — Channel-account pool throughput

Exercises the sponsored-submission channel pool (see issue #292). The pool leases a channel account per submission and fee-bumps from the treasury, so throughput should scale with the number of channels rather than serialising on a single source account.

Setup:
1. Configure the backend with `CHANNEL_POOL_SIZE=N` (see `backend/.env.example`) and fund each channel account above the top-up threshold.
2. Pre-seed one sponsored wallet per VU (or reuse a small set — the pool, not the wallet, is the contention point).
3. Run `scenarios/channel-pool.js` with `CHANNEL_POOL_SIZE` matching the backend config.

Each VU:
1. `POST /wallet/:id/transactions/build` (sponsored path).
2. Sign the XDR.
3. `POST /wallet/:id/transactions/submit`.

Expected result: **N channels ⇒ ~N transactions per ledger.** The scenario asserts this by reading the `X-Channel-Lease-Wait-Ms` and `X-Fee-Bump-Status` response headers and counting distinct channel accounts observed in the summary export.

Run against a staging deployment (not quickstart) so the treasury account, channel funding and Horizon rate limits match production:

```bash
cd backend/load-tests
K6_BASE_URL=https://staging.example.com \
CHANNEL_POOL_SIZE=8 \
k6 run scenarios/channel-pool.js \
  --summary-export=results/channel-pool-summary.json
```

---

## Budget Gates (thresholds)

These thresholds cause the k6 job to exit with a non-zero status, failing CI.

```js
thresholds: {
  // Latency
  'http_req_duration{scenario:concurrent_ramp}': ['p(95)<2000'],  // 2 s p95
  'http_req_duration{scenario:sustained_error_rate}': ['p(95)<3000'],

  // Error rate
  'http_req_failed{scenario:concurrent_ramp}': ['rate<0.01'],      // < 1 %
  'http_req_failed{scenario:sustained_error_rate}': ['rate<0.02'], // < 2 %

  // Submission-specific
  'checks{type:submission_success}': ['rate>0.95'],                // > 95 % submitted OK

  // Channel-account pool (Scenario E)
  'http_req_duration{scenario:channel_pool}': ['p(95)<2500'],
  'http_req_failed{scenario:channel_pool}': ['rate<0.01'],
  'channel_lease_wait_ms': ['p(95)<250'],                          // 250 ms p95 lease wait
  'fee_bump_failure_rate': ['rate<0.005'],                         // < 0.5 % fee-bump failures
  'checks{type:channel_parallelism}': ['rate>0.95'],               // ~N tx/ledger achieved
}
```

`channel_lease_wait_ms` is a custom trend fed from the `X-Channel-Lease-Wait-Ms` response header; `fee_bump_failure_rate` is a custom rate incremented when `X-Fee-Bump-Status` is not `success`. The `channel_parallelism` check compares observed distinct channel accounts per ledger against `CHANNEL_POOL_SIZE` and passes when at least 95 % of the configured channels are used concurrently.

Adjust these values after the baseline run from Scenario A.

---

## Lock Contention Metrics

Instrument the backend to emit a `lock_wait_ms` histogram metric (via the existing OpenTelemetry setup in `backend/src/telemetry`) whenever a database lock is acquired for a build or submit operation.

Expose this in the k6 script using the `http` response header `X-Lock-Wait-Ms` (populated by the backend middleware) and collect it as a custom trend metric:

```js
import { Trend } from 'k6/metrics';
const lockWait = new Trend('lock_wait_ms');

// inside the VU function:
lockWait.add(parseFloat(res.headers['X-Lock-Wait-Ms'] || '0'));
```

Add a threshold:

```js
'lock_wait_ms': ['p(95)<500'],  // 500 ms p95 lock wait
```

---

## Reports

k6 outputs a JSON summary (`--summary-export=results/summary.json`). Add a CI step that:

1. Runs the scenarios.
2. Uploads `results/` as a GitHub Actions artifact.
3. Posts a Markdown summary table to the PR using the `actions/github-script` action.

The summary table includes: scenario name, p50/p95 latency, error rate, lock wait p95, pass/fail per threshold.

---

## Directory Layout

```
backend/load-tests/
  submission-path-load-test-plan.md   ← this file
  scenarios/
    baseline.js                       ← Scenario A
    concurrent-ramp.js                ← Scenario B
    shared-wallet-contention.js       ← Scenario C
    sustained-error-rate.js           ← Scenario D
    channel-pool.js                   ← Scenario E (channel-account pool)
  config/
    thresholds.js                     ← shared budget gates
    test-data.js                      ← wallet IDs, key fixtures
  results/                            ← gitignored; CI artifact
```

---

## CI Integration

Add a job to `.github/workflows/` (runs on `push` to `main` and on PRs touching `backend/`):

```yaml
load-test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@<SHA>
    - name: Start quickstart
      run: docker compose up -d && sleep 20
    - name: Run k6 load tests
      uses: grafana/k6-action@<SHA>
      with:
        filename: backend/load-tests/scenarios/concurrent-ramp.js
        flags: --summary-export=backend/load-tests/results/summary.json
    - name: Upload results
      uses: actions/upload-artifact@<SHA>
      with:
        name: load-test-results
        path: backend/load-tests/results/
```

The `k6-action` exits non-zero when any threshold is breached, so the job fails automatically.

---

## Tasks

- [ ] Add `backend/load-tests/scenarios/baseline.js` (Scenario A)
- [ ] Add `backend/load-tests/scenarios/concurrent-ramp.js` (Scenario B)
- [ ] Add `backend/load-tests/scenarios/shared-wallet-contention.js` (Scenario C)
- [ ] Add `backend/load-tests/scenarios/sustained-error-rate.js` (Scenario D)
- [ ] Add `backend/load-tests/scenarios/channel-pool.js` (Scenario E)
- [ ] Add `backend/load-tests/config/thresholds.js` with budget gates
- [ ] Add `X-Lock-Wait-Ms` response header in backend build/submit middleware
- [ ] Add `X-Channel-Lease-Wait-Ms` and `X-Fee-Bump-Status` response headers in sponsored submit path
- [ ] Add `lock_wait_ms`, `channel_lease_wait_ms` OTel histograms and `fee_bump_failure_rate` counter
- [ ] Add CI workflow job with artifact upload
- [ ] Update README with instructions to run load tests locally
- [ ] Update docs where load-test behaviour or thresholds are described

---

## Running Locally

```bash
# Start the backend against quickstart
cd backend && cp .env.example .env && npm install && npm run dev

# In another terminal
cd backend/load-tests
k6 run scenarios/concurrent-ramp.js \
  --summary-export=results/summary.json \
  --out json=results/raw.json
```

Channel-pool scenario (Scenario E) against staging:

```bash
cd backend/load-tests
K6_BASE_URL=https://staging.example.com \
CHANNEL_POOL_SIZE=8 \
k6 run scenarios/channel-pool.js \
  --summary-export=results/channel-pool-summary.json \
  --out json=results/channel-pool-raw.json
```

Set `CHANNEL_POOL_SIZE` to the same value as the backend's `CHANNEL_POOL_SIZE` so the parallelism check has the right target. Run with at least two pool sizes (e.g. 1 and 8) to confirm throughput scales roughly linearly with the number of channels.

---

## Definition of Done

- [ ] Code merged to `main` with all scenarios passing their budgets
- [ ] All acceptance criteria checked (submission path load-tested, CI green, no unlinked TODOs)
- [ ] Channel-pool scenario demonstrates ~N tx/ledger for N channels on staging
- [ ] PR description links this issue (`Closes #235`, `Closes #292`) and lists any deferred work
- [ ] Docs updated where load-test behaviour changed
