# Backend design notes

Design notes written before implementation, as the issue guidelines require
("write a short design note … before the bulk of the implementation"). Each
note covers scope, the current state of the code, the proposed design, the
threat model, the data model, failure modes, the test plan and what is out of
scope. Link the note from the PR that implements it, and update it there if
the design changes during review.

| Issue | Note | Size | Depends on |
|---|---|---|---|
| #256 | [Error handler: safe messages, correlation ids, retryable classification](./256-error-handling.md) | L | none |
| #257 | [Unified cache with stampede protection](./257-unified-cache.md) | L | none |
| #258 | [Wallet and contract routes: thin handlers over a service layer](./258-route-service-layer.md) | L | #256 (preferred) |
| #259 | [SEP-24 / SEP-6 anchor integration](./259-anchor-integration.md) | XL | #256, #257, #258 |
| #287 | [Fee estimate accuracy tracking (classic and Soroban resource fees)](./287-fee-estimate-accuracy.md) | L | none |

**Suggested order:** #256 → #257 → #258 → #259. The error envelope and the
cache are building blocks that the route refactor and the anchor work both use.
Doing #258 before #259 means the anchor routes start out as thin handlers
instead of adding a third large route file. #287 is independent and can land in
parallel.

#274 is independent of the route/cache work but reuses the #256 error envelope
and stable error codes for its blob API.

> **Note on line counts.** The issues quote file sizes from commit `6fc71e5`
> (e.g. `wallet.ts` 674 lines, `jsonCache.ts`, `ttlCache.ts`). That commit is
> not in this repository's history. On `main`, `wallet.ts` is 344 lines,
> `contract.ts` is 118, and only `sorobanCache.ts` exists of the three cache
> files. These notes describe the code as it is on `main`.
