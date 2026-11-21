# Backend API

Express + TypeScript API for the Stellar Global Wallet.

## Getting started

The backend is an npm workspace, so install and build from the repo root:

```bash
cd ..                         # repo root
npm ci
npm run build:packages        # SDK + contract bindings the backend imports
cd backend
cp .env.example .env          # testnet defaults + a live demo contract ID
npm run dev                   # API on http://localhost:4000
npm test
npm run type-check
```

The `.env.example` points at a real testnet contract with a demo user, so read
endpoints work without deploying anything.

## Design specs

Proposed behaviour for in-progress hardening work:

- [API keys: hashed storage, scopes and rotation](docs/api-keys.md) (#251)
- [Pending multisig transactions: co-signing, validation and expiry](docs/multisig-pending-txs.md) (#248)
- [setOptions builder safety: preventing lockout](docs/set-options-safety.md) (#249)
- [Preferences API: conflict-safe updates and encryption at rest](docs/preferences.md) (#250)

## Contract event indexer
Postgres and Redis are expected at the URLs in `.env`; `docker compose up
-d postgres redis` from the repo root starts both.

## API documentation

The OpenAPI 3.1 contract lives in [`openapi.yaml`](./openapi.yaml). When the docs
are enabled, the server serves:

- **Interactive docs** — `GET /api/docs` (Swagger UI, backed by the spec below)
- **Raw spec** — `GET /api/openapi.json` (the YAML converted to JSON once at startup)

Docs are gated by the `ENABLE_API_DOCS` environment variable:

| `ENABLE_API_DOCS` | `NODE_ENV`  | Docs served |
| ----------------- | ----------- | ----------- |
| unset             | production  | no (404)    |
| unset             | anything else | yes       |
| `true`            | any         | yes         |
| `false`           | any         | no (404)    |

So a production build does **not** expose the docs by default; set
`ENABLE_API_DOCS=true` to opt in. When disabled, both routes return `404`.

Helmet's default Content-Security-Policy blocks the inline scripts Swagger UI
needs, so the docs routes get a route-specific CSP that allows them. The rest of
the API keeps the strict default policy.

The routes that let a wallet sign for itself (`/wallet/send/build`,
`/wallet/submit`, the path payment `/build` routes and the Soroban
`/contract/wallet/spend/build` + `/contract/wallet/submit`) are described in
[`docs/openapi-client-signing.yaml`](./docs/openapi-client-signing.yaml) and
walked through in [`docs/client-signing.md`](./docs/client-signing.md).

## Tests

```bash
npm test
```

Route tests use [supertest](https://github.com/ladjs/supertest) and cover the
happy path, validation failures and auth failures. Schema-conformance tests
check responses against `openapi.yaml`.

## Client runtime configuration

`GET /api/v1/config` is public and returns the configured Stellar network,
network passphrase, Horizon and Soroban RPC URLs, available contract IDs,
feature availability, and API/client versions. The response is cached for
60 seconds. Contract IDs are `null` when that contract is not configured;
the endpoint never serializes the complete server configuration or secrets.

## Upstream Horizon and Soroban RPC validation

Responses from `HORIZON_URL` and `SOROBAN_RPC_URL` are validated at runtime with
`zod` schemas and bounded by `HORIZON_MAX_RESPONSE_BYTES` and
`SOROBAN_RPC_MAX_RESPONSE_BYTES` (both default to `2097152` bytes / 2 MiB, with
a maximum of `200` records per page). Malformed or oversized upstream payloads
fail closed with HTTP `502` (`HORIZON_ERROR` or `SOROBAN_ERROR`,
`retryable: false`) in the shared error envelope rather than propagating
untyped casts or `500` errors. See
[`docs/upstream-validation.md`](./docs/upstream-validation.md) for the threat
model and schema coverage.

## Trustlines and wallet asset registry

- `POST /api/v1/wallet/trustline/build` returns unsigned `changeTrust` XDR.
  Omit `limit` to use the maximum Stellar trustline limit; pass `"0"` to
  remove a trustline. Removal requires an existing trustline with zero
  balance. The response reports `reserveDelta` and `spendableXlmAfter`;
  removing a sponsored trustline can have a zero reserve impact for the
  account because the sponsor supplied the reserve.
- `POST /api/v1/contract/wallet/assets/build` and
  `POST /api/v1/contract/wallet/assets/remove/build` build unsigned Soroban
  transactions for the wallet's asset registry. `AssetInfo` has a 1–12
  character alphanumeric `code` and an `issuer`; native XLM uses `issuer:
  null`. Removal is rejected while that asset has a configured spend limit.

These endpoints only build transactions. The client must show the reserve
change (an unsponsored trustline addition locks 0.5 XLM), obtain the user's
signature through their wallet, and use a supported submission flow.

Failures use the shared error envelope and stable `error.code` values:
`INSUFFICIENT_RESERVE` and `ASSET_ISSUER_NOT_FOUND` for trustline additions,
`TRUSTLINE_NOT_FOUND` and `TRUSTLINE_HAS_BALANCE` for trustline removal,
`ASSET_ALREADY_ADDED` for duplicate wallet assets, and
`ASSET_HAS_ACTIVE_SPEND_LIMIT` when a wallet asset still has a spend limit.

## Legacy secret-key route migration

The legacy routes below emit `Deprecation`, `Sunset`, and `Link` headers and
write a structured warning containing the route and request ID. The sunset is
January 1, 2027. They continue to work until removal, but clients should stop
sending secret keys to the API. A caller that can observe request bodies in
transit, application logs, telemetry, or a compromised backend process could
use an exposed key to sign transactions and move the account's funds.

| Legacy route | Migration |
| --- | --- |
| `POST /api/v1/wallet/send` | Use a wallet-native signing flow. The unsigned payment build/submit equivalent is not part of this change. |
| `POST /api/v1/wallet/partial-transaction` | Stop sending source secret keys; use client-side signing when a build endpoint is available for the operation. |
| `POST /api/v1/wallet/fee-bump` | Do not send a fee-source secret key; no fee-bump build/submit replacement is included here. |
| `POST /api/v1/wallet/path-payment-strict-send` and `...strict-receive` | Do not send a source secret key; use a client-side signed path-payment flow when available. |
| `POST /api/v1/contract/wallet/spend` | Use the unsigned `record_spend` build/submit flow when available; it is not part of this change. |
| `POST /api/v1/wallet/keypair` | Generate and protect keys in the user's wallet; the server must not be the source of a user's secret key. |

The deprecation headers are additive. Authentication and validation behavior
otherwise remain unchanged.

## Activity Feed and Event Indexing

The activity feed (`GET /api/v1/wallet/:publicKey/activity`) combines Horizon
payment history with Soroban contract events. The backend indexes contract
events to a durable PostgreSQL table with:

- **Durable cursor persistence**: The indexer commits event IDs and cursor
  position in the same database transaction, ensuring no event loss on crash.
- **Retention gap detection**: When the indexer's cursor falls behind RPC's
  ~7-day event retention window, it detects the gap and reconciles state.
- **Idempotent event ingestion**: Events are upserted by ID to prevent
  duplicates on restart or retry.
- **Lag monitoring**: Alerts are logged when the indexer is more than 100
  ledgers behind the current ledger.

The indexer runs as a background worker and can be configured via:

- `INDEXER_START_LEDGER`: Ledger to start indexing from (default: 0 = start from latest)
- `INDEXER_POLL_INTERVAL_MS`: Poll frequency in milliseconds (default: 5000)
- `INDEXER_PAGE_SIZE`: Max events per page (default: 200)

## Cache Invalidation

The Soroban cache (`#86`) provides 15-second TTL caching for read operations.
To prevent stale data after state changes:

- **Event-driven invalidation**: When the indexer detects state-mutating events
  (guardian changes, recovery changes, migration events), it broadcasts
  invalidation messages via Redis pub/sub to all backend instances.
- **Cross-instance invalidation**: All instances subscribe to the invalidation
  channel and invalidate their local caches when events occur.
- **Read-your-writes**: After a transaction is submitted, reads for that user
  bypass the cache until the transaction is confirmed, ensuring users see
  the effect of their own changes immediately.

Cache metrics are logged to stdout for integration with log aggregation tools
(Datadog, CloudWatch, etc.).

## Rate limits and idempotency

Rate limits apply per account for write routes. The API supports idempotency
keys for safe retries; see [`docs/idempotency-key-header.md`](./docs/idempotency-key-header.md).
