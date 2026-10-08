# Stellar Global Wallet

GlobeWallet is a multi-asset wallet built on Stellar. This monorepo contains the backend API and the Soroban smart contracts.

| Package | Path | Stack | Status |
|---|---|---|---|
| Backend API | [`backend/`](backend/) | Node.js 20 + Express + TypeScript | In progress |
| Smart contracts | [`contract/`](contract/) | Rust + Soroban (Stellar) | In progress |
| Web frontend | — | — | Not started |
| Mobile app | — | — | Not started |

## Design

The UI is designed in this Figma file template: [GlobeWallet design](https://claude.ai/artifact/HAEA9kUpEhSMCyjDwCBL6t#page-dcb81aee8d83). Use it as the reference when building the web frontend and the mobile app.

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

GitHub Actions runs a separate workflow for each package, and only when that package changes:

- `.github/workflows/backend.yml` runs type-checking and tests for `backend/`
- `.github/workflows/contract.yml` runs `cargo check` and `cargo test` for `contract/`

## Roadmap

- [ ] Web frontend, built from the Figma design
- [ ] Mobile app, built from the Figma design
- [ ] Connect the backend to the deployed contracts
