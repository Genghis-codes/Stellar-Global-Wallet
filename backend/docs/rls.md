# PostgreSQL Row-Level Security (RLS)

All user-scoped PostgreSQL tables enforce Row-Level Security (`ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`) as defence in depth against Insecure Direct Object Reference (IDOR) bugs and missing `WHERE account = $1` predicates (#282).

## Protected tables

`ensureAuditTable()` (`src/db.ts`) calls `ensureRlsPolicies()`, which enables and forces RLS on every user-scoped table:

| Table | Owner column | Account isolation policy | Service bypass policy |
| --- | --- | --- | --- |
| `devices` | `account` | `devices_account_isolation` | `devices_service_bypass` |
| `verified_emails` | `account` | `verified_emails_account_isolation` | `verified_emails_service_bypass` |
| `user_preferences` | `account` | `user_preferences_account_isolation` | `user_preferences_service_bypass` |
| `sessions` | `account` | `sessions_account_isolation` | `sessions_service_bypass` |
| `idempotency_keys` | `source_public_key` | `idempotency_keys_account_isolation` | `idempotency_keys_service_bypass` |
| `pending_txs` | `account` | `pending_txs_account_isolation` | `pending_txs_service_bypass` |

`keypair_audit_log` is a system-wide security audit log (not owned by an end-user Stellar account) and remains write-only for audit recording.

## Least-privilege database roles

PostgreSQL superusers and roles with `BYPASSRLS` ignore even `FORCE ROW LEVEL SECURITY`. During bootstrap, `ensureRlsPolicies()` idempotently creates two `NOLOGIN NOSUPERUSER NOBYPASSRLS` roles when the connected database user has `CREATEROLE` permission (such as local Docker PostgreSQL or migration runners):

- `globe_wallet_app`: assumed via `SET LOCAL ROLE globe_wallet_app` for request-scoped and unscoped queries.
- `globe_wallet_service`: assumed via `SET LOCAL ROLE globe_wallet_service` inside `withServiceRole(...)`.

On managed PostgreSQL instances where roles are provisioned externally without `CREATEROLE`, `ensureRlsPolicies()` catches `insufficient_privilege` cleanly and `FORCE ROW LEVEL SECURITY` enforces policies on the non-superuser application login role.

## Request transaction context (`app.account`)

1. **Middleware binding (`jwtAuth`):** Once a Bearer access token is verified, `jwtAuth` wraps downstream middleware and route handlers in `runWithRequestAccount(payload.sub, ...)`.
2. **Explicit request transactions (`withAccountContext`):** Route handlers that access user-scoped tables (`devices`, `verified_emails`, `user_preferences`, `pending_txs`, `idempotency_keys`) wrap database work in `withAccountContext(account, async (tx) => ...)`:
   - Checks out a dedicated `PoolClient` and opens `BEGIN`.
   - Runs `SET LOCAL ROLE globe_wallet_app` (when available).
   - Sets transaction-local GUCs via `SELECT set_config('app.role', 'authenticated', true), set_config('app.account', $1, true)` — PostgreSQL's parameterized equivalent of `SET LOCAL app.account = ...`, avoiding SQL string interpolation while guaranteeing automatic reset on `COMMIT` or `ROLLBACK`.
3. **Unscoped queries fail closed:** Any query executed outside `withAccountContext`, `runWithRequestAccount`, and `withServiceRole` runs with `app.account = ''` and `app.role = ''`. Neither permissive policy matches, so `SELECT`, `UPDATE`, and `DELETE` affect zero rows and `INSERT` raises PostgreSQL error `42501` (`new row violates row-level security policy`).

## Background jobs (`withServiceRole`)

Background workers that legitimately read across accounts (`src/services/paymentNotifier.ts` and `src/services/recoveryNotifier.ts`) wrap their database reads in `withServiceRole(fn, { jobName })`, which sets transaction-local `app.role = 'service'` (`SET LOCAL ROLE globe_wallet_service`) for the duration of that transaction only.

For multisig co-signing (`src/routes/pendingTx.ts`), where a co-signer's JWT `sub` differs from the source account in `pending_txs.account`, `PgPendingTxStore.getForSignerCheck` resolves the target transaction solely to verify on-chain signer membership via Horizon (`assertSigner`), after which mutations execute under `withAccountContext(row.account, ...)`.
