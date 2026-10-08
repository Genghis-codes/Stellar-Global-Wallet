# GlobeWallet

Monorepo for the GlobeWallet backend API and Soroban smart contracts.

| Package | Path | Stack |
|---|---|---|
| Backend API | [`backend/`](backend/) | Node.js 20 + Express + TypeScript |
| Smart contracts | [`contract/`](contract/) | Rust + Soroban (Stellar) |

The web frontend ([Globe-Wallet](https://github.com/Orbit-Wal/Globe-Wallet)) and mobile app ([mobile](https://github.com/Orbit-Wal/mobile)) live in their own repositories.

## Getting started

### Backend

```bash
cd backend
cp .env.example .env   # fill in your values
npm install
npm run dev
```

### Contracts

```bash
cd contract
cargo test --workspace
cargo build --release --target wasm32-unknown-unknown
```

See each package's README and CONTRIBUTING guide for details.

## CI

GitHub Actions runs per package and only when that package changes:

- `.github/workflows/backend.yml` — type-check and tests for `backend/`
- `.github/workflows/contract.yml` — `cargo check` and `cargo test` for `contract/`

## History

This repo was assembled with `git subtree` from
[Orbit-Wal/backend](https://github.com/Orbit-Wal/backend) and
[Orbit-Wal/contract](https://github.com/Orbit-Wal/contract); the full commit history of both is preserved.
