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

A lock acquisition timeout (Redis backend only) maps to:

```
503 Service Unavailable
{ "error": "...", "code": "LOCK_TIMEOUT", "retryable": true }
```

Both are `retryable: true` because in both cases this request's funds were
not moved — the caller can safely retry rather than needing to manually
reconcile against Horizon.
