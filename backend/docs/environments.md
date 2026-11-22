# Environment matrix

Which URL do I use? This table is the answer, for every environment this
backend actually runs in today plus the one planned for later. Every value
below is a real default from [`.env.example`](../.env.example) or
[`src/config.ts`](../src/config.ts) — not illustrative placeholders — so
copying a row here should just work.

| | Local | Testnet (current) | Mainnet (future) |
|---|---|---|---|
| **API base URL** | `http://localhost:4000` (`PORT`) | wherever this backend is actually deployed — not yet a fixed public URL; see [HACKMD.md](../../HACKMD.md) for deployment status | not deployed yet |
| **Stellar network** | Testnet | Testnet | Mainnet |
| **Network passphrase** | `Test SDF Network ; September 2015` | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| **Horizon URL** (`HORIZON_URL`) | `https://horizon-testnet.stellar.org` | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |
| **Soroban RPC URL** (`SOROBAN_RPC_URL`) | `https://soroban-testnet.stellar.org` | `https://soroban-testnet.stellar.org` | not configured — no mainnet Soroban RPC URL has been chosen yet |
| **Soroban network passphrase** (`SOROBAN_NETWORK_PASSPHRASE`) | `Test SDF Network ; September 2015` | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| **globe-wallet contract ID** (`GLOBE_WALLET_CONTRACT_ID`) | the real testnet demo contract baked into `.env.example` (`CBGLPMNSM4FWMIZ6FFBSRN7FNVCHCI2SLZNODA27LEOXFPLWNYEAEP3K`, with one demo user already funded — see the comment above it in `.env.example`) | same testnet contract, or your own if you've deployed one from `contract/` | not deployed — `GET`/`POST /api/v1/contract/wallet/*` return `503` until a mainnet contract ID is set |
| **Feature flags** (`GET /api/v1/flags`) | defaults in `src/services/featureFlags.ts`, override via `FEATURE_FLAGS` env var | same — set per-deployment in whatever secret/env store that environment uses | not decided; almost certainly starts with `recovery: false` (no recovery flow is implemented at all yet, local or otherwise) |
| **CORS origins** (`CORS_ORIGIN`) | `http://localhost:3000,exp://localhost:8081` (web dev server + Expo) | the actual deployed web/mobile app origins for that environment | the actual production web/mobile app origins |
| **Trust proxy hops** (`TRUST_PROXY_HOPS`) | `0` (no proxy in front of a local `npm run dev`) | `1` (one load balancer — the `.env.example` default) | must match the real topology; see `src/config.ts`'s comment on this variable and `docs/concurrency.md` — getting this wrong silently breaks per-IP rate limiting |
| **Lock backend** (`LOCK_BACKEND`) | `in-process` (fine for a single local process) | `redis` once more than one instance is running behind a load balancer — see `docs/concurrency.md` | `redis` (mainnet is assumed multi-instance for availability) |

## Local setup

```bash
git clone https://github.com/Genghis-codes/Stellar-Global-Wallet.git
cd Stellar-Global-Wallet/backend
cp .env.example .env   # testnet defaults + a live demo contract ID, see above
npm install
npm run dev             # API on http://localhost:4000
```

`.env.example`'s defaults are the "Testnet (current)" column above — you
get a working, real-testnet backend with zero contract deployment or
network-config changes.

## Testnet resets

Stellar testnet is periodically reset: the ledger sequence restarts and all
contracts and accounts are wiped. When that happens the contract ID in
`contract/deployments/testnet.json` (and `GLOBE_WALLET_CONTRACT_ID`) no
longer exists on-chain, so contract-backed endpoints start failing.

### Detection

A reset is detected when either of the following is observed against the
live chain:

- the current ledger sequence is **lower** than the last sequence recorded
  in `contract/deployments/testnet.json` (a ledger sequence drop), or
- the deployed contract ID from the manifest is **missing** on-chain
  (Soroban RPC reports no contract instance / Horizon reports the account
  gone).

### Automated recovery

On detection the backend runs the redeploy + reseed pipeline:

1. Redeploy the `globe-wallet` contract to the fresh testnet and capture the
   new contract ID.
2. Reseed the demo wallet (fund the demo account and re-create its demo
   state) so read endpoints keep working without manual setup.
3. Rewrite `contract/deployments/testnet.json` with the new contract ID and
   the current ledger sequence.
4. Notify connected clients of the change (the manifest/config endpoints
   reflect the new contract ID; clients should re-query
   `GET /api/v1/config`).

### Runbook (manual fallback)

If automated recovery does not complete (e.g. the deployer key is
unavailable or the pipeline fails partway):

1. Confirm the reset: compare the live ledger sequence and contract
   existence against `contract/deployments/testnet.json`.
2. From `contract/`, redeploy the contract to testnet and note the new
   contract ID.
3. Reseed the demo wallet for the new contract.
4. Update `contract/deployments/testnet.json` (contract ID + ledger
   sequence) and set `GLOBE_WALLET_CONTRACT_ID` in the environment's
   secret store to the new ID.
5. Restart/redeploy the backend so it picks up the new contract ID, then
   verify `GET /api/v1/config` and a contract read endpoint succeed.
6. Notify frontend developers that the testnet preview is back and the
   contract ID changed.

## Protocol upgrade readiness

Stellar protocol upgrades (and the matching `soroban-sdk` releases) can
break wallets that aren't prepared. To get early warning, CI runs a
**next-protocol** job on a weekly schedule (and on manual dispatch) that
exercises the contract workspace and the backend e2e suite against the
*next* protocol version rather than the pinned one:

- **Contracts**: `cargo test --workspace` in `contract/` with the next
  `soroban-sdk` version, so SDK-level breaking changes surface before the
  upgrade lands on testnet/mainnet.
- **Backend e2e**: the `backend/tests/e2e` suite against a Stellar
  Quickstart `future`/next image, so RPC/Horizon behaviour changes are
  caught end-to-end.

A failing next-protocol run is the early-warning signal: it opens/updates a
tracking issue (or notifies maintainers) rather than blocking normal PRs.
The pinned versions used by the regular CI stay unchanged — only this
scheduled job tracks the next protocol.

### Upgrade checklist

When a protocol/SDK bump is announced, work through this list before
upgrading the pinned versions:

1. **Read the release notes** for the protocol version and the
   `soroban-sdk` release; note any breaking changes to host functions,
   XDR, or RPC.
2. **Check the next-protocol CI run** — is it green? If not, the failing
   job's log is the list of breaking changes to address.
3. **Update `contract/Cargo.toml`** to the new `soroban-sdk` version and run
   `cargo test --workspace` locally.
4. **Re-run the backend e2e suite** against the new Quickstart image
   (`backend/tests/e2e`) and fix any RPC/Horizon behaviour changes.
5. **Record breaking changes** in the tracking issue opened by the
   next-protocol job so the upgrade history is auditable.
6. **Update this doc and the environment matrix** if any URL, passphrase,
   or contract behaviour changed.
7. **Deploy to testnet first**, verify `GET /api/v1/config` and a contract
   read endpoint, then promote.

## Mainnet: what's actually missing, not just config

The "Mainnet (future)" column above is mostly "not configured yet" rather
than a value to copy, because mainnet isn't just a different set of URLs —
real gaps exist:

- No contract has been deployed to mainnet (`contract/` targets testnet in
  its own docs/tooling today).
- No mainnet Soroban RPC URL has been selected/vetted.
- The custodial secret-key handling documented in
  [`docs/security-model.md`](security-model.md) is explicitly flagged there
  as the *current, transient* architecture — moving real funds through it
  on mainnet is a bigger decision than flipping an env var, and that
  document's "future migration path toward client-side signing" section is
  the relevant context before anyone points this at mainnet for real.

Treat the Mainnet column as a checklist of what has to be decided and
built, not a set of values waiting to be pasted into a `.env`.

## Keeping this in sync

**With `GET /api/v1/flags`**: the Feature flags row should always match
what that endpoint actually returns for a given environment — if you add
or change a flag in `src/services/featureFlags.ts`, update this table in
the same change.

**With `GET /api/v1/config` (and `/config`)**: runtime network passphrase,
Horizon/RPC URLs, and contract upgrade timelock state are exposed dynamically
at runtime via `GET /api/v1/config` (issue #81). Client applications should query
this endpoint to read live configuration and inspect pending contract upgrades.

**With `contract/deployments/testnet.json`**: after any testnet reset and
recovery (automated or manual), the contract ID and ledger sequence in that
manifest must match what the backend is actually using — see the testnet
reset runbook above.
