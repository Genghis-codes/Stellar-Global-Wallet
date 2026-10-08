# GlobeWallet — Backend

REST API for the GlobeWallet ecosystem, built with Node.js + Express + TypeScript.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 LTS |
| Framework | Express 4 |
| Language | TypeScript (strict) |
| Stellar | @stellar/stellar-sdk (Horizon + Soroban RPC) |
| Validation | express-validator + Zod |
| Security | helmet, cors, express-rate-limit |
| Database | PostgreSQL (via pg) |
| Cache | Redis |

## Getting Started

```bash
cp .env.example .env   # fill in your values
npm install
npm run dev            # hot-reload dev server (tsx watch)
```

## API Reference

### Health

```
GET /health
```

### Account

```
GET  /api/v1/account/:publicKey              → account info
GET  /api/v1/account/:publicKey/balances     → { balances: { XLM: "...", ... } }
GET  /api/v1/account/:publicKey/transactions → paginated transaction list
```

### Wallet

```
POST /api/v1/wallet/keypair  → generate a new keypair (public + secret)
POST /api/v1/wallet/send     → submit a payment transaction
```

Body for `/send`:
```json
{
  "sourceSecretKey": "S...",
  "destinationPublicKey": "G...",
  "amount": "10.0000000",
  "asset": "XLM",
  "memo": "optional"
}
```

Concurrent `/send` calls for the same source account are serialized
per-account (see [`docs/concurrency.md`](docs/concurrency.md)) — set
`LOCK_BACKEND=redis` before running more than one instance of this API,
or that serialization only holds within a single process.

### Contract (Soroban — `globe-wallet`)

```
GET  /api/v1/contract/wallet/:publicKey/assets  → { assets: [{ code, issuer }] }
POST /api/v1/contract/wallet/spend              → { hash, ledger, successful }
```

`GET .../assets` is public (read-only, simulated, no fee). `POST .../spend`
requires a Bearer token (same as `/wallet/send`) and body:
```json
{

  "userSecretKey": "S...",
  "assetCode": "XLM",
  "amount": "1000000"

}

```
Requires `GLOBE_WALLET_CONTRACT_ID` — see `.env.example` and
[`docs/soroban-integration.md`](docs/soroban-integration.md) for the
design rationale and a real testnet run.

### Price

```
GET /api/v1/price/:asset  → placeholder only; always returns { price_usd: null,
                             source: "not_configured" } until a real oracle
                             (CoinGecko / Stellar DEX orderbook) is wired up
                             in src/routes/price.ts
```

## Project Structure

```
src/
  app.ts           # Express app factory
  index.ts         # Entry point
  config.ts        # Environment config validation (Zod)
  db.ts            # Postgres pool + audit table bootstrap
  routes/          # Route handlers
  middleware/       # Auth, error handling, rate limiting
  services/        # Stellar SDK, Soroban RPC, contract clients, locks
  utils/           # Helpers (JWT)
  types/           # Shared TypeScript types
tests/             # Jest unit/integration tests
docs/              # Design docs (e.g. concurrency.md)
```

## Related Repos

- [`Orbit-Wal/Globe-Wallet`](https://github.com/Orbit-Wal/Globe-Wallet) — Web frontend
- [`Orbit-Wal/mobile`](https://github.com/Orbit-Wal/mobile) — React Native app
- [`Orbit-Wal/contract`](https://github.com/Orbit-Wal/contract) — Soroban smart contracts
