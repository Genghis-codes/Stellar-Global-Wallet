# 🌍 Stellar Global Wallet — Project Overview

![Network](https://img.shields.io/badge/network-testnet-orange?style=for-the-badge&logo=stellar)
![Backend](https://img.shields.io/badge/backend-in%20progress-blue?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Contracts](https://img.shields.io/badge/contracts-in%20progress-blue?style=for-the-badge&logo=rust)
![Frontend](https://img.shields.io/badge/frontend-not%20started-lightgrey?style=for-the-badge&logo=react)
![Mobile](https://img.shields.io/badge/mobile-not%20started-lightgrey?style=for-the-badge&logo=android)
![Audit](https://img.shields.io/badge/audit-not%20audited-red?style=for-the-badge)

Stellar Global Wallet (GlobeWallet) is a multi-asset wallet on Stellar. This monorepo holds the **backend API** and the **Soroban smart contracts**. The frontend and mobile app have not been built yet; the UI exists as a [Figma file template](https://claude.ai/artifact/HAEA9kUpEhSMCyjDwCBL6t#page-dcb81aee8d83).

---

## 🗺️ The big picture

Solid boxes exist today. Dashed boxes are still to be built.

```mermaid
flowchart LR
    subgraph CLIENTS["👤 Clients (not built)"]
        WEB["🖥️ Web app<br/>Next.js"]
        MOB["📱 Mobile app<br/>React Native"]
    end

    subgraph API["⚙️ backend/"]
        EXP["Express API<br/>TypeScript"]
        PG[("PostgreSQL<br/>audit log")]
        RD[("Redis<br/>locks")]
    end

    subgraph STELLAR["🌐 Stellar testnet"]
        HZ["Horizon"]
        RPC["Soroban RPC"]
        GW["📜 globe-wallet"]
        TW["📜 token-wrapper"]
    end

    WEB -.->|"not wired"| EXP
    MOB -.->|"not wired"| EXP
    EXP --- PG
    EXP --- RD
    EXP -->|"payments, balances"| HZ
    EXP -->|"get_assets, record_spend"| RPC
    RPC --> GW
    GW -->|"transfer_from"| TW

    classDef todo stroke-dasharray: 5 5,fill:#f5f5f5,color:#999
    classDef live fill:#e8f4ff,stroke:#2b7bd6
    classDef chain fill:#f3e8ff,stroke:#7d00ff
    class WEB,MOB todo
    class EXP,PG,RD live
    class HZ,RPC,GW,TW chain
```

| | Package | Stack | Status |
|:-:|---|---|:-:|
| ⚙️ | `backend/` | Node.js 20 · Express 4 · TypeScript · PostgreSQL · Redis | 🟡 Testnet |
| 📜 | `contract/` | Rust · Soroban SDK 21.7.7 | 🟡 Testnet |
| 🖥️ | Web frontend | Next.js (planned) | ⚪ Not started |
| 📱 | Mobile app | React Native / Expo (planned) | ⚪ Not started |

---

## ⚙️ Backend

### How a request flows through the layers

```mermaid
flowchart TB
    REQ(["HTTP request"]) --> MW
    subgraph MW["Middleware"]
        direction LR
        H["helmet + cors"] --> RL["rate limit"] --> AUTH["JWT auth"] --> VAL["validation"]
    end
    MW --> ROUTES
    subgraph ROUTES["Routes /api/v1"]
        direction LR
        R1["auth"] ~~~ R2["account"] ~~~ R3["wallet"] ~~~ R4["contract"] ~~~ R5["price"]
    end
    ROUTES --> SVC
    subgraph SVC["Services"]
        direction LR
        S1["stellar.ts<br/>Horizon"] ~~~ S2["soroban.ts<br/>RPC"] ~~~ S3["globeWallet.ts<br/>contract client"] ~~~ S4["locks · audit · idempotency"]
    end
    SVC --> ERR["errorHandler → JSON error"]
```

### Folder layout

```
backend/
├── src/
│   ├── index.ts · app.ts · config.ts · db.ts
│   ├── routes/        account · wallet · contract · auth · price
│   ├── middleware/    jwtAuth · apiKeyAuth (deprecated) · errorHandler · requestValidation
│   ├── services/      stellar · soroban · contracts/globeWallet · locks/ · auditLog · idempotency
│   ├── utils/         jwt · stellarAddress
│   └── validation/    stellarAsset
├── tests/             Jest + Supertest
└── docs/              concurrency · security-model · soroban-integration
```

### API map

| Group | Method | Endpoint | Auth |
|---|:-:|---|:-:|
| 💓 Health | `GET` | `/health` | — |
| 🔑 Auth | `POST` | `/api/v1/auth/login` · `/refresh` · `/logout` | API key → JWT |
| 👤 Account | `GET` | `/api/v1/account/:publicKey` · `/balances` · `/transactions` | — |
| 💸 Wallet | `POST` | `/api/v1/wallet/send` · `/fee-bump` · `/keypair` | 🔒 JWT |
| 🔀 Path payments | `POST` | `/wallet/path-payment-strict-send` · `/path-payment-strict-receive` · `/paths/strict-send` · `/paths/strict-receive` | 🔒 JWT |
| 👥 Multisig | `POST`/`GET` | `/wallet/partial-transaction` · `/submit-multisig` · `/:publicKey/thresholds` | 🔒 JWT |
| 📜 Contract | `GET` | `/api/v1/contract/wallet/:publicKey/assets` | — |
| 📜 Contract | `POST` | `/api/v1/contract/wallet/spend` | 🔒 JWT |
| 💲 Price | `GET` | `/api/v1/price/:asset` | — *(placeholder, returns `null`)* |

### A contract call, step by step

```mermaid
sequenceDiagram
    autonumber
    participant C as Client (curl / tests)
    participant API as Express API
    participant RPC as Soroban RPC
    participant GW as globe-wallet

    C->>API: POST /contract/wallet/spend (JWT)
    API->>API: validate body, take per-account lock
    API->>RPC: simulateTransaction(record_spend)
    RPC-->>API: fee + result (fails early on SpendLimitExceeded)
    API->>RPC: sendTransaction(signed XDR)
    loop every 1.5s, up to 30s
        API->>RPC: getTransaction(hash)
    end
    RPC->>GW: record_spend(user, asset, amount)
    GW-->>RPC: ✅ spend recorded
    RPC-->>API: SUCCESS + ledger
    API-->>C: { hash, ledger, successful }
```

---

## 📜 Smart contracts

### The two contracts and how they compose

```mermaid
flowchart LR
    U(["👤 User"]) -->|"1 · approve(spender = globe-wallet)"| TW
    U -->|"2 · send(token, to, amount)"| GW

    subgraph GW["📜 globe-wallet"]
        direction TB
        CHK{"token allowed?"} -->|yes| LIM["record_spend<br/>daily limit check"]
    end

    LIM -->|"3 · transfer_from"| TW["📜 token-wrapper<br/>allowance + expiry"]
    TW -->|"4 · transfer"| TOK[("🪙 Soroban token")]
    TOK --> R(["👤 Recipient"])
```

### `globe-wallet` capabilities

```mermaid
mindmap
  root((globe-wallet))
    Admin
      initialize
      propose / accept admin
      cancel transfer
    Upgrades
      propose_upgrade
      execute_upgrade after timelock
    Social recovery
      guardians
      quorum approvals
      timelocked execution
    Assets
      add / remove asset
      get_assets
      migrate_user_assets
    Spend limits
      set / get limit
      record_spend
    Payments
      allowed tokens
      token wrapper
      send
```

### Social recovery lifecycle

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Pending: guardian calls initiate_recovery
    Pending --> Pending: approve_recovery / revoke_recovery_approval
    Pending --> Quorum: approvals ≥ threshold
    Quorum --> Pending: revoke drops below threshold (timelock resets)
    Quorum --> Executed: execute_recovery after delay
    Pending --> Idle: admin calls cancel_recovery
    Quorum --> Idle: admin calls cancel_recovery
    Executed --> [*]: new admin installed
```

### Daily spend limit at a glance

| Rule | Behaviour |
|---|---|
| ⏱️ Window | 86,400 s, bucketed by ledger timestamp, resets automatically |
| ♾️ `limit = 0` | Unlimited |
| 🚫 Over limit | `SpendLimitExceeded` and no tokens move |
| ⚠️ Scope | Enforced inside `globe-wallet` only (see *bypass* below) |

### Folder layout

```
contract/
├── Cargo.toml                     workspace · release profile · ed25519-dalek patch
├── contracts/
│   ├── globe-wallet/              src/lib.rs · tests/ · test_snapshots/
│   └── token-wrapper/             src/lib.rs · test_snapshots/
├── vendor/ed25519-dalek-2.2.0/    pinned transitive dependency
└── docs/design/                   architecture · record_spend boundary · reentrancy threat model
```

---

## 🔌 Not connected to a frontend

```mermaid
flowchart LR
    F["🖥️📱 Frontend / Mobile<br/><i>does not exist</i>"]
    API["⚙️ Backend API"]
    T["🧪 Jest tests + curl"]
    F -.-x|"no client · no SDK · no OpenAPI"| API
    T ==>|"only consumer today"| API
    style F stroke-dasharray: 5 5,fill:#f5f5f5,color:#999
```

The API has no real consumer yet. `CORS_ORIGIN` is preset for `localhost:3000` (Next.js) and `exp://localhost:8081` (Expo), but these are placeholders. The UI exists only as the Figma template.

---

## 🧪 Still on testnet

| | Setting | Value |
|:-:|---|---|
| 🌐 | Horizon | `https://horizon-testnet.stellar.org` |
| 🛰️ | Soroban RPC | `https://soroban-testnet.stellar.org` |
| 🔐 | Passphrase | `Test SDF Network ; September 2015` |
| 📜 | globe-wallet (demo) | `CBGLPMNSM4FWMIZ6FFBSRN7FNVCHCI2SLZNODA27LEOXFPLWNYEAEP3K` |
| 📜 | token-wrapper | ❌ not deployed |
| 🛡️ | Audit | ❌ none |

### Road to mainnet

```mermaid
flowchart LR
    A["✅ Contracts<br/>on testnet"] --> B["🔐 Client-side<br/>signing"] --> C["📜 Deploy<br/>token-wrapper"] --> D["🖥️ Build<br/>frontend"] --> E["🛡️ Security<br/>audit"] --> F["🚀 Mainnet"]
    style A fill:#d4f7d4,stroke:#2e7d32
    style F fill:#ffe0b2,stroke:#ef6c00
```

---

## 🚀 Possible improvements

| Priority | Area | Improvement |
|:-:|---|---|
| 🔴 | Security | **Stop sending secret keys to the API.** `/wallet/send` and `/contract/wallet/spend` take `S...` keys in the body. Sign on the client (Freighter, xBull, passkeys) and submit XDR only. |
| 🔴 | Security | `/wallet/keypair` returns a secret key. Generate keys on the client instead. |
| 🔴 | Contracts | A direct `token-wrapper::transfer_from` call **bypasses the daily spend limit**. Restrict callers to globe-wallet. |
| 🔴 | Contracts | Third-party audit before mainnet. |
| 🟠 | Contracts | Upgrade `soroban-sdk` from 21.7.7, commit `Cargo.lock`, add deploy scripts per network. |
| 🟠 | Backend | Expose the full contract surface: assets, limits, guardians and recovery, `send`. |
| 🟠 | Backend | Publish an OpenAPI spec and a typed client for the frontend. |
| 🟡 | Backend | Real price oracle (Stellar DEX, Reflector or CoinGecko) in place of the placeholder. |
| 🟡 | Backend | Event indexer that writes contract events into Postgres. |
| 🟡 | DevOps | Dockerfile + docker-compose, lint / `clippy` / `fmt` in CI, end-to-end tests on testnet. |
| 🟢 | Product | Build the web and mobile apps from the Figma template. |
| 🟢 | Backend | Remove the deprecated `x-api-key` middleware. |

<sub>🔴 before mainnet · 🟠 next up · 🟡 soon · 🟢 planned</sub>
