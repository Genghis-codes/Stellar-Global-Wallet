# Stellar Global Wallet — Project Overview

> **Status:** backend and smart contracts are in active development on **Stellar testnet**. The frontend and mobile app have **not been built yet**.

---

## 1. What this repo is

Stellar Global Wallet (GlobeWallet) is a multi-asset wallet built on Stellar. This monorepo contains the two layers that exist today:

| Layer | Path | Stack | Status |
|---|---|---|---|
| Backend API | `backend/` | Node.js 20 · Express 4 · TypeScript · PostgreSQL · Redis | In progress (testnet) |
| Smart contracts | `contract/` | Rust · Soroban SDK 21.7.7 | In progress (testnet) |
| Web frontend | — | — | Not started |
| Mobile app | — | — | Not started |

UI design reference: [Figma file template](https://claude.ai/artifact/HAEA9kUpEhSMCyjDwCBL6t#page-dcb81aee8d83)

```
Stellar-Global-Wallet/
├── backend/          # REST API (Express + TypeScript)
├── contract/         # Soroban smart contracts (Rust workspace)
├── .github/
│   ├── workflows/    # backend.yml, contract.yml (path-filtered CI)
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE/
├── README.md
└── HACKMD.md         # this file
```

---

## 2. Backend structure (`backend/`)

The backend is a REST API that talks to Stellar Horizon for classic operations and to Soroban RPC for contract calls.

```
backend/
├── src/
│   ├── index.ts                  # entry point
│   ├── app.ts                    # Express app factory (helmet, cors, morgan, rate limit, routers)
│   ├── config.ts                 # env validation with Zod
│   ├── db.ts                     # Postgres pool + audit table bootstrap
│   ├── routes/
│   │   ├── account.ts            # account info, balances, transactions
│   │   ├── wallet.ts             # payments, fee bump, path payments, multisig, keypair
│   │   ├── contract.ts           # globe-wallet contract reads/writes
│   │   ├── auth.ts               # login / refresh / logout (JWT)
│   │   └── price.ts              # price lookup (placeholder)
│   ├── middleware/               # jwtAuth, apiKeyAuth (deprecated), errorHandler, requestValidation
│   ├── services/
│   │   ├── stellar.ts            # Horizon client: payments, fee bump, path payments, SEP-29, retries
│   │   ├── soroban.ts            # Soroban RPC: simulate → send → poll
│   │   ├── contracts/globeWallet.ts  # typed client for the globe-wallet contract
│   │   ├── locks/                # per-account send lock (in-process or Redis)
│   │   ├── auditLog.ts, idempotency.ts
│   │   └── *Errors.ts            # Stellar / Soroban / contract error mapping
│   ├── utils/                    # JWT helpers, Stellar address helpers
│   └── validation/               # asset validation
├── tests/                        # Jest + Supertest (routes, services, locks, middleware)
└── docs/                         # concurrency.md, security-model.md, soroban-integration.md
```

### API surface

| Group | Endpoints |
|---|---|
| Health | `GET /health` |
| Auth | `POST /api/v1/auth/login`, `/refresh`, `/logout` |
| Account | `GET /api/v1/account/:publicKey`, `/balances`, `/transactions` |
| Wallet | `POST /api/v1/wallet/send`, `/fee-bump`, `/path-payment-strict-send`, `/path-payment-strict-receive`, `/paths/strict-send`, `/paths/strict-receive`, `/partial-transaction`, `/submit-multisig`, `/keypair`; `GET /api/v1/wallet/:publicKey/thresholds` |
| Contract | `GET /api/v1/contract/wallet/:publicKey/assets`, `POST /api/v1/contract/wallet/spend` |
| Price | `GET /api/v1/price/:asset` (placeholder that always returns `null`) |

### Key behaviours

- **Auth:** an API key is exchanged once for a JWT access and refresh token pair. Protected routes then use `Bearer` tokens.
- **Concurrency:** `/wallet/send` calls for the same source account run one at a time. The lock is in-process by default; set `LOCK_BACKEND=redis` when running more than one instance.
- **Audit and idempotency:** sensitive actions are written to a Postgres audit table.
- **Contract calls:** the backend wraps only two globe-wallet functions so far, `get_assets` (simulated, free) and `record_spend` (signed and submitted).

---

## 3. Contract structure (`contract/`)

The contracts are a Cargo workspace with two Soroban contracts.

```
contract/
├── Cargo.toml                    # workspace, release profile, ed25519-dalek patch
├── contracts/
│   ├── globe-wallet/
│   │   ├── src/lib.rs            # core wallet contract + unit tests
│   │   ├── tests/record_spend_reentrancy.rs
│   │   └── test_snapshots/
│   └── token-wrapper/
│       ├── src/lib.rs            # allowance-gated transfers + unit tests
│       └── test_snapshots/
├── vendor/ed25519-dalek-2.2.0/   # vendored to pin a transitive dependency
└── docs/                         # architecture, record_spend boundary, reentrancy threat model
```

### `globe-wallet`: the core wallet registry

| Area | Functions |
|---|---|
| Init & admin | `initialize`, `admin`, `transfer_admin`, `propose_admin`, `accept_admin`, `cancel_admin_transfer` |
| Upgrades (timelocked) | `propose_upgrade`, `execute_upgrade` |
| Social recovery | `add_guardian`, `remove_guardian`, `guardians`, `set_recovery_config`, `recovery_config`, `initiate_recovery`, `approve_recovery`, `revoke_recovery_approval`, `execute_recovery`, `cancel_recovery`, `recovery_proposal` |
| Per-user assets | `add_asset`, `remove_asset`, `get_assets`, `migrate_user_assets` |
| Daily spend limits | `set_spend_limit`, `get_spend_limit`, `record_spend` |
| Payments | `set_token_wrapper`, `get_token_wrapper`, `add_allowed_token`, `remove_allowed_token`, `is_token_allowed`, `send` |

- Spend limits are set per user and per asset over a daily window of 86,400 seconds. A limit of `0` means unlimited.
- `send` checks the daily limit with `record_spend`, then moves tokens through `token-wrapper`. A test covers protection against a reentrant malicious token.

### `token-wrapper`: allowance-gated transfers

- `approve`, `allowance` and `transfer_from` sit on top of the Soroban token interface. Each allowance has an expiry.
- `approve` **overwrites** an existing allowance rather than adding to it.
- If the underlying token transfer fails, the allowance is rolled back.

---

## 4. Not connected to a frontend

There is **no frontend or mobile client** in this project yet, and nothing consumes the backend API today.

- The API is only exercised by its Jest/Supertest test suite and by manual `curl` calls.
- `CORS_ORIGIN` defaults to `http://localhost:3000,exp://localhost:8081`. These are placeholders for a future Next.js web app and Expo mobile app.
- No SDK, OpenAPI spec or typed client exists yet for a frontend to use.
- The UI exists only as the Figma template linked above.

The integration path is therefore: **Frontend/Mobile (to build) → Backend API → Horizon + Soroban RPC → globe-wallet / token-wrapper contracts**.

---

## 5. Still on testnet

Everything is configured for the **Stellar testnet**, and nothing is on mainnet.

| Setting | Value |
|---|---|
| Horizon | `https://horizon-testnet.stellar.org` |
| Soroban RPC | `https://soroban-testnet.stellar.org` |
| Network passphrase | `Test SDF Network ; September 2015` |
| Deployed globe-wallet contract | `CBGLPMNSM4FWMIZ6FFBSRN7FNVCHCI2SLZNODA27LEOXFPLWNYEAEP3K` (testnet demo) |

- The testnet contract has one demo user with an XLM asset and a daily limit of 10,000,000 stroops.
- The `token-wrapper` contract has no documented deployment.
- The contracts have **not been audited**, and there is no mainnet deployment pipeline.

---

## 6. Possible improvements

### Security (do these before mainnet)
- **Stop sending secret keys to the server.** `/wallet/send`, `/contract/wallet/spend` and similar routes accept `S...` secret keys in the request body. Move to client-side signing: the frontend signs XDR with a wallet such as Freighter, xBull or a mobile keystore, and the backend only builds and submits transactions.
- **Do not return secrets from `/wallet/keypair`.** Generate keys on the client.
- Remove the deprecated `x-api-key` middleware and keep JWT only.
- Get a third-party **smart contract audit** before mainnet.
- Close the gap where a direct `token-wrapper::transfer_from` call **bypasses globe-wallet's daily limit**. Restrict callers or move limit enforcement into the transfer path.

### Contracts
- Upgrade `soroban-sdk` from the pinned 21.7.7 to a current release, with migration testing.
- Commit `Cargo.lock` for reproducible WASM builds.
- Add deploy scripts for testnet and mainnet using the Stellar CLI, plus contract ID management per network.
- Deploy `token-wrapper` to testnet and wire it to the deployed globe-wallet with `set_token_wrapper`.

### Backend
- Expose the rest of the contract surface: asset management, spend limits, guardians and recovery, and `send`.
- Implement a real price oracle (Stellar DEX orderbook, CoinGecko or Reflector) in place of the placeholder.
- Publish an **OpenAPI/Swagger spec** and generate a typed client for the frontend.
- Add an event indexer that reads contract events such as `spend_recorded` and `asset_added` into Postgres.
- Add a Dockerfile, docker-compose (Postgres and Redis) and a deploy target.
- Add a network switch so testnet and mainnet are chosen by environment variable and validated at startup.

### Frontend & mobile (to be built)
- Build a web app (Next.js) and a mobile app (React Native / Expo) from the Figma template.
- Integrate wallets (Freighter, WalletConnect, or a passkey-based smart wallet).
- Add screens for balances, send and receive, asset management, spend limits and guardian recovery.

### DevOps
- Add end-to-end tests against testnet in CI.
- Add linting to backend CI and `cargo clippy` / `cargo fmt --check` to contract CI.
- Automate builds and releases of the contract WASM.
