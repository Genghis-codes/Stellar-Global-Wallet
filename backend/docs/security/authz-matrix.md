# Route Authorization Matrix & IDOR Security Test Suite

**GitHub issue:** [#233](https://github.com/Genghis-codes/Stellar-Global-Wallet/issues/233)  
**Test suite:** [`backend/tests/security/authzMatrix.test.ts`](../../tests/security/authzMatrix.test.ts)  
**Policy manifest:** [`backend/tests/security/authzPolicy.ts`](../../tests/security/authzPolicy.ts)  
**Router enumerator:** [`backend/tests/security/routeEnumerator.ts`](../../tests/security/routeEnumerator.ts)

---

## Purpose

Account scoping in GlobeWallet is enforced across Express routers via `jwtAuth`, `requireAccountMatch`, per-route signer checks (`pending-txs`), and `req.user.sub`-derived `/api/v1/me/*` queries. Without an automated, exhaustive gate, adding a new route or renaming a request parameter can silently introduce an Insecure Direct Object Reference (IDOR) bug.

This suite provides two CI-enforced guarantees:

1. **Zero unclassified routes:** `enumerateAppRoutes(createApp())` walks the live Express router stack recursively and compares every `(METHOD, PATH)` pair against `ROUTE_AUTHZ_POLICY`. Any route added without an explicit classification — or any stale policy entry — fails CI immediately.
2. **Exhaustive caller matrix:** Every mounted route is exercised across five caller classes:

| Caller | Credentials sent | Represents |
|---|---|---|
| `anon` | None | Unauthenticated internet caller |
| `otherAccount` | `Authorization: Bearer <JWT sub=BOB>` | Authenticated Stellar account attempting cross-account access against ALICE's resource |
| `ownAccount` | `Authorization: Bearer <JWT sub=ALICE>` | Authenticated Stellar account acting on its own resource |
| `apiKeyHeader` | `x-api-key: <API_KEY>` (no Bearer token) | Legacy header; accepted **only** on `/api/v1/auth/login` and `/api/v1/admin/rotate-jwt-keys` (#40) |
| `apiKeyJwt` | `Authorization: Bearer <JWT sub="api-key-user">` | Legacy shared operator JWT obtained from `/api/v1/auth/login` |

---

## `requireAccountMatch` actor-field resolution (#266)

`requireAccountMatch` no longer scans a priority list of actor fields. Each protected route declares **exactly one** actor field via route metadata, and the middleware validates only that field:

- **Route metadata:** `requireAccountMatch({ source: 'body', field: 'sourcePublicKey' })` (or `'params'` / `'query'`). The declared field is the single source of truth for the actor identity.
- **Ambiguous requests rejected:** If the request carries more than one actor field (`sourcePublicKey`, `user`, `guardian`, `admin`, `account`, `currentAdmin`, `candidate`, `innerAccount`, `userPublicKey`, …) with **different** values, the request is rejected with `403 ACCOUNT_MISMATCH` before the handler runs. This closes the confused-deputy gap where a caller sets `sourcePublicKey` to their own account while a lower-priority field names the victim.
- **Deny by default:** A protected route that names **no** actor field is rejected with `400 ACCOUNT_REQUIRED` (missing actor) rather than passing through. Routes that derive the actor from a secret key or from `req.user.sub` are unaffected and continue to be classified as `authenticated-account-scoped` / `authenticated-self`.

### Authz matrix additions

| Scenario | Expected |
|---|---|
| Own `sourcePublicKey` + victim `user` (different values) | `403 ACCOUNT_MISMATCH` |
| Protected route with no actor field | `400 ACCOUNT_REQUIRED` |
| Declared actor field matches `sub` | Allowed |
| Declared actor field differs from `sub` | `403 ACCOUNT_MISMATCH` |

---

## Authorization Classes & Expected Outcomes

| `AuthzClass` | `anon` | `otherAccount` (BOB → ALICE) | `ownAccount` (ALICE → ALICE) | `apiKeyHeader` (raw `x-api-key`) | `apiKeyJwt` (`sub=api-key-user`) |
|---|---|---|---|---|---|
| `public` | Allowed (not 401/403) | Allowed | Allowed | Allowed | Allowed |
| `login-api-key` | `401 API_KEY_UNAUTHORIZED` | `401 API_KEY_UNAUTHORIZED` | `401 API_KEY_UNAUTHORIZED` | Allowed | `401 API_KEY_UNAUTHORIZED` |
| `admin-api-key` | `401 API_KEY_UNAUTHORIZED` | `401 API_KEY_UNAUTHORIZED` | `401 API_KEY_UNAUTHORIZED` | Allowed | `401 API_KEY_UNAUTHORIZED` |
| `authenticated-account-scoped` | `401 TOKEN_MISSING` | **`403 ACCOUNT_MISMATCH`** | Allowed | `401 AUTH_HEADER_INVALID` | Allowed (legacy non-G subject) |
| `authenticated-signer-scoped` | `401 TOKEN_MISSING` | **`403 FORBIDDEN`** | Allowed (when signer) | `401 AUTH_HEADER_INVALID` | **`403 FORBIDDEN`** |
| `authenticated-self` | `401 TOKEN_MISSING` | Isolated to BOB's namespace (`404` on ALICE's device ID; **`403 ACCOUNT_MISMATCH`** on ALICE's email token) | Allowed | `401 AUTH_HEADER_INVALID` | Allowed (scoped to `api-key-user`) |
| `authenticated-unscoped` | `401 TOKEN_MISSING` | Allowed (stateless utility) | Allowed | `401 AUTH_HEADER_INVALID` | Allowed |

> **Error envelope invariant:** Every 401/403/404 response asserted by the matrix must conform to `{ error: { code, message, ... } }` where `code` is a registered member of `ERROR_CODES` (`backend/src/errors/codes.ts`).

---

## Route Inventory by Class

### `authenticated-account-scoped` (strict `sub === targetAccount` for `G...` JWTs)
- `GET /api/v1/account/:publicKey/transactions/export.csv` (`req.params.publicKey`)
- `GET /api/v1/transactions/account/:accountId/statuses` (`req.params.accountId`)
- `POST /api/v1/wallet/send/build` (`body.sourcePublicKey`)
- `POST /api/v1/wallet/path-payment-strict-send/build` (`body.sourcePublicKey`)
- `POST /api/v1/wallet/path-payment-strict-receive/build` (`body.sourcePublicKey`)
- `POST /api/v1/wallet/submit` (inner envelope `source` or fee-bump `feeSource`)
- `POST /api/v1/wallet/trustline/build` (`body.account`)
- `POST /api/v1/wallet/send` (derived from `body.sourceSecretKey`)
- `POST /api/v1/wallet/send/precheck` (`body.sourcePublicKey`)
- `POST /api/v1/wallet/fee-bump` (derived from `body.feeSecretKey`)
- `POST /api/v1/wallet/sponsor-fee` (`body.innerAccount` AND `innerTx.source`)
- `POST /api/v1/wallet/path-payment-strict-send` (derived from `body.sourceSecretKey`)
- `POST /api/v1/wallet/path-payment-strict-receive` (derived from `body.sourceSecretKey`)
- `POST /api/v1/wallet/:publicKey/muxed` (`req.params.publicKey`)
- `POST /api/v1/wallet/set-options/build` (`body.sourcePublicKey`)
- `POST /api/v1/wallet/partial-transaction` (derived from `body.sourceSecretKey`)
- `POST /api/v1/wallet/submit-multisig` (derived from `body.signerSecretKeys`)
- `GET /api/v1/wallet/:publicKey/thresholds` (`req.params.publicKey`)
- `POST /api/v1/contract/wallet/assets/build` (`body.user`)
- `POST /api/v1/contract/wallet/assets/remove/build` (`body.user`)
- `POST /api/v1/contract/wallet/guardians/add/build` (`body.admin`)
- `POST /api/v1/contract/wallet/guardians/remove/build` (`body.admin`)
- `POST /api/v1/contract/wallet/recovery/initiate/build` (`body.guardian`)
- `POST /api/v1/contract/wallet/recovery/approve/build` (`body.guardian`)
- `POST /api/v1/contract/wallet/recovery/revoke-approval/build` (`body.guardian`)
- `POST /api/v1/contract/wallet/recovery/execute/build` (`body.sourcePublicKey`)
- `POST /api/v1/contract/wallet/recovery/cancel/build` (`body.admin`)
- `POST /api/v1/contract/wallet/spend-limit/build` (`body.user`)
- `POST /api/v1/contract/admin/propose` (`body.currentAdmin`)
- `POST /api/v1/contract/admin/accept` (`body.candidate`)
- `POST /api/v1/contract/admin/cancel` (`body.currentAdmin`)
- `POST /api/v1/contract/wallet/spend` (derived from `body.userSecretKey`)
- `POST /api/v1/contract/wallet/spend/build` (`body.userPublicKey`)
- `POST /api/v1/contract/wallet/submit` (envelope inner `source` or fee-bump `feeSource`)

### `authenticated-signer-scoped` (on-chain signer membership verified via Horizon)
- `POST /api/v1/pending-txs`
- `GET /api/v1/pending-txs`
- `GET /api/v1/pending-txs/:id`
- `POST /api/v1/pending-txs/:id/signatures`
- `DELETE /api/v1/pending-txs/:id` (creator-only)

### `authenticated-self` (subject derived exclusively from `req.user.sub`)
- `GET /api/v1/me/devices`, `POST /api/v1/me/devices`, `DELETE /api/v1/me/devices/:id`
- `GET /api/v1/me/email`, `POST /api/v1/me/email`, `POST /api/v1/me/email/verify`
- `GET /api/v1/me/preferences`, `PUT /api/v1/me/preferences`

### `authenticated-unscoped` (Bearer JWT required, stateless utility)
- `GET /api/v1/resolve`
- `POST /api/v1/wallet/payment-requests`, `POST /api/v1/wallet/payment-requests/parse`
- `POST /api/v1/wallet/paths/strict-send`, `POST /api/v1/wallet/paths/strict-receive`
- `POST /api/v1/wallet/keypair`

### `login-api-key` & `admin-api-key`
- `POST /api/v1/auth/login` (`requireLoginApiKey`)
- `POST /api/v1/admin/rotate-jwt-keys` (`requireLoginApiKey`)

### `public`
- Infrastructure & docs: `GET /health`, `GET /metrics`, `GET /api/v1/health/details`, `GET /api/v1/health/metrics`, `GET /.well-known/jwks.json`, `GET /auth/csrf`, `POST /csp-report`, `POST /api/v1/csp-report`, `GET /api/openapi.json`
- Configuration & discovery: `GET /config`, `GET /api/v1/config`, `GET /api/v1/flags`, `GET /api/v1/network/fees`, `GET /api/v1/network/info`, `GET /api/v1/price`, `GET /api/v1/price/:asset`, `GET /api/v1/price/:asset/history`, `GET /api/v1/assets/verified`, `GET /api/v1/assets/search`, `GET /api/v1/assets/:code/:issuer`
- Auth exchange endpoints: `GET /api/v1/auth/challenge`, `POST /api/v1/auth/token`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`
- Public on-ledger reads: `GET /api/v1/account/:publicKey{,/balances,/signers,/reserves,/transactions,/payments,/activity}`, `POST /api/v1/account/:publicKey/muxed`, `GET /api/v1/transactions/:hash`, `GET /api/v1/transactions/s

/* … truncated 3221 chars — edit only what you need near the top … */
