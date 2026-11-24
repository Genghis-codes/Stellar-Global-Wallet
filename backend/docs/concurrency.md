# Concurrency: submitting payments for the same source account

## The problem (issue #3)

`StellarService.sendPayment` used to call `getAccount(sourcePublicKey)` fresh
on every invocation, then build, sign, and submit a transaction using
whatever sequence number that read returned — with no coordination between
concurrent calls.

Two requests to `POST /api/v1/wallet/send` for the **same** source secret
key, arriving close enough together, would both read the same starting
sequence number. Horizon accepts the first submission it processes and
rejects the second with `tx_bad_seq` (or, as reproduced below, sometimes a
504 while it's still deciding) — and the caller of the losing request had
no way to tell, from the response alone, whether their payment happened or
not. The only way to find out was to re-query Horizon for the account's
current state.

This is not theoretical: reproduced against live Stellar testnet (see
below), firing two concurrent sends from one account, one landed and the
other came back as a bare `{"error":"Request failed with status code
504"}` — no indication of what happened, no guidance on what to do next.

## The fix

`sendPayment` now serializes the read-build-sign-submit sequence per
source account through an `AccountLock` (`src/services/locks/`):

```
withLock(sourcePublicKey, async () => {
  const account = await getAccount(sourcePublicKey); // always fresh
  ...
  return submitTransaction(tx);
});
```

Because `submitTransaction` doesn't resolve until the transaction has
landed in a ledger (or definitively failed), by the time the next queued
call for that account runs, the account's sequence number already
reflects the previous submission. No manual sequence tracking is needed —
serializing the whole unit of work is sufficient and avoids a second class
of bugs (manually incrementing a cached sequence number and having it
drift from reality).

Two backends implement `AccountLock`:

| Backend | File | Guarantee |
|---|---|---|
| `in-process` (default) | `accountLock.ts` — `InProcessAccountLock` | Serializes calls for the same account **within one Node process**, via a promise chain keyed by account id. Zero external dependencies. |
| `redis` | `redisAccountLock.ts` — `RedisAccountLock` | Serializes calls for the same account **across every process pointed at the same Redis**, via `SET NX PX` + a token-checked Lua release script. |

Selected by `LOCK_BACKEND` in `.env` (`in-process` by default; set to
`redis` to use the already-required `REDIS_URL`).

## Why this bullet matters: in-process locking is not enough for multiple instances

**If you run more than one instance of this API** (multiple processes,
containers, or pods behind a load balancer — the normal way to scale this
service horizontally), `InProcessAccountLock` does **not** help you. Each
instance has its own independent `Map` in its own memory. Two requests for
the same source account, routed by the load balancer to two different
instances, are invisible to each other's lock — you get exactly the
original race, just spread across processes instead of within one.

**This is why `RedisAccountLock` exists and why it's a genuine fix, not
just a documented gap:** it moves the mutual-exclusion state out of any
single process's memory and into Redis, which every instance already talks
to (or can). Set `LOCK_BACKEND=redis` before running more than one
instance against the same source accounts, and all instances share one
lock per account.

### Operational tradeoffs of `RedisAccountLock`

- **Single point of coordination.** This is a `SET NX PX` lock with a
  token-checked release (safe against one instance deleting another's
  lock after its own expired) — not the full multi-node Redlock
  algorithm. It's correct for coordinating N API instances against one
  Redis (or one primary + replicas), but it does not tolerate a Redis
  primary failover happening *during* a held lock the way Redlock's
  quorum approach would.
- **TTL vs. submission time.** The lock has a TTL (default 45s) so a
  crashed instance can't wedge an account's lock forever. That TTL must
  stay comfortably above the worst-case time a single submission can take
  — bounded here by `setTimeout(30)` on the transaction plus Horizon's
  poll overhead. If a submission ever legitimately took longer than the
  TTL, a second instance could acquire the lock while the first is still
  "logically" holding it. Given this codebase's fixed 30s transaction
  timeout, 45s leaves real margin; revisit this constant if that timeout
  changes.
- **Fail closed, not silently unsafe.** If Redis is unreachable, lock
  acquisition times out and `sendPayment` throws `LockAcquisitionError`
  (mapped to HTTP 503) rather than silently proceeding unlocked. A
  submission is refused, never raced.
- **Redis down at startup.** `createAccountLock()` calls `client.connect()`
  before the server starts serving traffic, so a misconfigured/unreachable
  Redis fails fast at boot when `LOCK_BACKEND=redis`, the same way a bad
  `NETWORK_PASSPHRASE` does today.

### What we did not do (and why)

We did not make Redis the default. Single-instance deployments (the
common case for this project today) get full correctness from
`InProcessAccountLock` with zero extra moving parts and no dependency on a
reachable Redis at boot. Multi-instance operators opt in explicitly via
`LOCK_BACKEND=redis`, at which point they must also have `REDIS_URL`
actually point at a reachable instance shared by every replica — a config
mistake here (e.g., each instance given a different Redis, or Redis
omitted from a multi-instance rollout) reproduces the original race, so
this is called out explicitly rather than left implicit.

## Error surfaced to the caller

If a submission is still rejected for a sequence-related reason (for
instance: `LOCK_BACKEND=redis` wasn't set in a multi-instance deployment,
or the same secret key is being used to submit from somewhere outside this
service entirely), `sendPayment` no longer lets Horizon's raw
`tx_bad_seq` response reach the caller unexplained. It's translated into a
`SequenceConflictError` (`src/services/stellarErrors.ts`), which
`errorHandler` maps to:

```
409 Conflict
{ "error": "...explains what happened and that it's safe to retry...", "code": "SEQUENCE_CONFLICT", "retryable": true }
```

A lock acquisition timeout (either backend) maps to:

```
503 Service Unavailable
{ "error": "...", "code": "LOCK_TIMEOUT", "retryable": true }
```

Both are `retryable: true` because in both cases this request's funds were
not moved — the caller can safely retry rather than needing to manually
reconcile against Horizon.

## Unified lock semantics (issue #197)

Both backends now extend one base class (`BaseAccountLock` in
`accountLock.ts`) and only differ in where the lock table lives (a `Map`
vs Redis). Tests pass in-memory and behave the same in production because
the same contract suite (`tests/locks/accountLockContract.ts`) runs against
both.

| Property | Both backends |
|---|---|
| Lease | Held for `ttlMs` (45s default), renewed every `ttlMs / 3` while the callback runs. A holder that dies stops renewing and its lease expires. |
| Fencing token | `lease.fencingToken`, strictly increasing per account across all holders (Redis: `INCR` in the same Lua script as `SET NX PX`). |
| Release | Token-checked (Lua `GET == token` then `DEL` in Redis), on success and on error. A stale holder can't free a newer holder's lock. |
| Wait | Retries every `retryDelayMs` (in-process also wakes on release) until `maxWaitMs` (30s), then `LOCK_TIMEOUT` 503. |
| Reentrancy | None. A nested `withLock` on the same account times out. |
| Fairness | Best effort only; no FIFO guarantee. |

The in-process lock used to wait forever and guarantee FIFO order. It now
times out like Redis does, so a stuck submission can't hold requests open
indefinitely.

**Fail closed.** With `LOCK_BACKEND=redis`, the process refuses to start if
Redis is unreachable, and at runtime the client runs with
`disableOfflineQueue`, so a Redis outage fails each acquisition at once with
`LOCK_UNAVAILABLE` (503, retryable). Nothing is ever submitted unlocked.

**Metrics** (`GET /api/v1/health/metrics`): `account_lock_wait_ms`
(histogram), `account_lock_contended_total`, `account_lock_failures_total`
(`reason="timeout"|"unavailable"`) and `account_lock_lease_lost_total`, all
labelled by `backend`.

## Channel account pool (issue #292)

The per-source-account lock above makes a single source account **correct**
under concurrency, but it also makes it **serial**: every sponsored
submission from that account waits for the previous one to land. Stellar
gives each account one sequence number per ledger, so one source account
caps throughput at roughly one transaction per ledger (~5s) no matter how
many requests arrive.

The channel account pool removes that cap by spreading sponsored
submissions across N pre-funded "channel" accounts, each of which has its
own sequence number and can therefore submit in parallel. With N healthy
channels you get ~N transactions per ledger.

### How it fits with the account lock

The two mechanisms are complementary and both stay in place:

| Concern | Mechanism |
|---|---|
| Two requests must not reuse one account's sequence number | `AccountLock` (in-process or Redis) — unchanged |
| Many requests must not queue behind one account | Channel pool — a submission leases a *free* channel, so requests for different channels never contend |

A sponsored submission now:

1. Acquires a **lease** on a channel account from the pool (see below).
2. Runs the existing read-build-sign-submit sequence under
   `withLock(channelPublicKey, ...)` — the lock is now keyed by the
   *channel* account, not the treasury/source account.
3. Releases the lease back to the pool.

Because the lock key is the channel, two concurrent submissions that lease
different channels proceed in parallel; two that somehow lease the same
channel still serialise safely. The lock remains the last line of defence
against sequence reuse; the pool is what gives you parallelism.

### Lease semantics

- A lease is granted to exactly one in-flight submission at a time. A
  channel with an active lease is never handed to a second submission.
- Leases are **time-bounded** (same TTL discipline as the account lock,
  comfortably above the worst-case submission time). A submission that
  crashes or hangs without releasing its lease does not wedge that channel
  forever — the lease expires and the channel returns to the pool.
- Leases are **token-checked on release**, so a submission whose lease
  already expired cannot release a channel that a newer submission now
  holds.
- When every channel is leased, acquisition waits up to `maxWaitMs` and
  then fails closed with the existing `LOCK_TIMEOUT` (503, retryable)
  envelope — a request is refused, never submitted on a contended channel.
- With `LOCK_BACKEND=redis`, leases live in Redis alongside the account
  locks, so the pool is shared across every API instance. With
  `in-process`, the pool is per-process (same single-instance caveat as
  the lock — see above).

### Fee-bump from treasury

Sponsored transactions are wrapped in a **fee-bump** transaction whose fee
source is the treasury account, not the channel account:

- The inner transaction is built and signed by the channel account (which
  supplies the sequence number).
- The outer fee-bump is signed by the treasury key and pays the network
  fee, so channel accounts never need a large XLM balance for fees — only
  the minimum reserve plus a small buffer.
- This keeps fee policy in one place (the treasury) and lets fees be
  raised without re-funding every channel.

### Auto top-up and monitoring

Channel accounts must stay above the minimum reserve or their
transactions are rejected. The pool therefore:

- **Monitors** each channel's XLM balance and reports it via
  `GET /api/v1/health/metrics` (per-channel balance gauge, plus
  `channel_pool_leased` / `channel_pool_available` gauges and a
  `channel_pool_lease_wait_ms` histogram).
- **Auto-tops-up** any channel that drops below a configured threshold by
  sending a payment from the treasury, subject to the same lock discipline
  so top-ups never race a submission on that channel.
- Emits `channel_pool_topup_total` and `channel_pool_topup_failures_total`
  so a treasury that is itself running dry is visible before submissions
  start failing.

### When to enable it

- **Single instance, low volume:** the pool is optional. The account lock
  alone is correct; you just get one tx per ledger.
- **High-throughput sponsored submissions, or multiple instances:** enable
  the pool (`CHANNEL_POOL_ENABLED=true`, `CHANNEL_POOL_SIZE=N`) and set
  `LOCK_BACKEND=redis` so leases and locks are shared across instances.
- Size the pool to your target throughput: N channels ≈ N tx/ledger. Each
  channel costs the base reserve plus a small fee buffer, funded from the
  treasury.

If the pool is disabled, behaviour is exactly as documented above — a
single source account serialised by the account lock.
