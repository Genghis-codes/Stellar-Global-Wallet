# GlobeWallet — Contract

Soroban smart contracts for the GlobeWallet protocol on the Stellar network.

## Contracts

| Contract | Description |
|---|---|
| `globe-wallet` | Core wallet registry — asset whitelist, spend limits, admin governance |
| `token-wrapper` | Allowance-gated token transfers for protocol integrations |

## Stack

| Layer | Technology |
|---|---|
| Platform | Stellar / Soroban |
| Language | Rust (`#![no_std]`) |
| SDK | soroban-sdk 21.x |
| Build | stellar-cli (>= 25.2) |

## Getting Started

Install the Soroban CLI:

```bash
cargo install --locked stellar-cli
```

Build all contracts:

```bash
# soroban-sdk 29 must be built by stellar-cli >= 25.2 (wasm32v1-none target)
stellar contract build
```

> **Debug builds are for local development only.** The workspace also defines
> a `release-with-logs` profile (`stellar contract build --profile release-with-logs`)
> that enables `debug-assertions` on top of `release` to surface assertion
> failures during development and testing. Despite the name, it does **not**
> add runtime logging — Soroban contracts log via `env.events().publish(...)`,
> which is included in both profiles. A WASM built with `release-with-logs`
> is **never deploy-safe**: always deploy the plain `release` build below.

Run tests:

```bash
cargo test
```

Deploy to testnet (requires funded keypair):

```bash
soroban contract deploy \
  --wasm target/wasm32v1-none/release/globe_wallet.wasm \
  --source <SECRET_KEY> \
  --network testnet
```

### Local network (offline development)

Testnet resets and Friendbot rate limits slow down iterating on contracts.
Run a local, standalone Stellar network with [`stellar/quickstart`](https://github.com/stellar/quickstart)
instead:

```bash
# from the repo root
docker compose --profile local up -d stellar   # waits for :8000/health internally

# build + deploy both contracts to it, writes deployments/local.json
./contract/scripts/deploy-local.sh
```

`deployments/local.json` records the network RPC URL, passphrase, deployer
address and both contracts' IDs. The script prints the exact
`backend/.env` values to copy so the API can talk to the local deployment
instead of testnet. The file is gitignored — it's a fresh deployment
record every time the quickstart container restarts, not something to
commit. See [`backend/docs/e2e-local-testing.md`](../backend/docs/e2e-local-testing.md)
for running the full hermetic contract + backend + SDK E2E suite (#232), and
[`docs/threat-model.md`](../docs/threat-model.md) for the system-wide threat model (#238).

## Contract: `globe-wallet`

### API

```rust
// Admin
initialize(env, admin)
admin(env) -> Address
transfer_admin(env, current, new_admin)

// Asset registry (self-sovereign, user.require_auth())
add_asset(env, user, asset: AssetInfo) -> Result<()>
remove_asset(env, user, asset_code: String) -> Result<()>
get_assets(env, user) -> Vec<AssetInfo>

// Spend limits
set_spend_limit(env, user, asset_code, limit: i128) -> Result<()>
get_spend_limit(env, user, asset_code) -> i128
record_spend(env, user, asset_code, amount) -> Result<()>

// Emergency pause (#191)
set_pauser(env, admin, pauser: Option<Address>) -> Result<()>  // admin only
pauser(env) -> Option<Address>
pause_sends(env, caller) -> Result<()>     // pauser or admin
unpause_sends(env, admin) -> Result<()>    // admin only (use a multisig admin)
is_send_paused(env) -> bool
```

### Emergency pause

`pause_sends` blocks `send` with `SendsPaused` (1039). Nothing else is paused:
admin rotation, upgrades, guardian management and social recovery keep
working, so a pause never locks the owners out of handling the incident. The
pauser can be a hot incident-response key, because it can only stop sends. It
cannot unpause or change anything else. Only the admin can unpause, so if the
admin is a multisig account, unpausing needs the multisig. The backend reports
the flag at `GET /api/v1/contract/status` (`sendsPaused`).

### Spend Limit Logic

- Limit is per-user, per-asset, over a **rolling 24 h window** (hourly buckets
  from ledger timestamp, see [docs/design/record_spend_boundary.md](docs/design/record_spend_boundary.md)).
  There is no midnight reset, so the limit cannot be spent twice around 00:00 UTC.
- `limit = 0` means unlimited. Spends are still recorded, so a limit set later
  counts what was already spent.
- `record_spend` is called from any payment path; rejects with `SpendLimitExceeded` if
  the total spent in the last 24 h would exceed the limit.
- `get_spend_allowance` reports `spent`, `remaining` and `next_refill_at`.
- `migrate_user_assets` trims only the display list; limits of trimmed assets stay.
- Spend limits are enforced **within globe-wallet only**. Transfers routed
  directly through token-wrapper bypass the daily cap unless the integrator
  calls `record_spend` first. See [docs/design/architecture.md](docs/design/architecture.md).

## Contract: `token-wrapper`

Provides `approve` / `allowance` / `transfer_from` semantics on top of the
Soroban token interface, enabling the globe-wallet contract to move tokens
on behalf of users within a session allowance.

> **Important:** `approve` uses **overwrite** semantics — calling it again
> for the same `(owner, spender)` pair **replaces** the previous allowance
> rather than adding to it. See the function's doc comment for details.
>
> See **[docs/design/architecture.md](docs/design/architecture.md)** for how
> globe-wallet and token-wrapper are intended to compose, the current state
> of their interaction, and integration guidance.

## Design proposals

Designs for planned work. Each one describes the intended behaviour, API,
errors, events and test plan before the implementation lands:

- [Allowance expiry vs storage TTL](docs/design/allowance-expiry-and-ttl.md) (#244)
- [Batched multi-send with atomic limits](docs/design/batched-send.md) (#245)
- [Scheduled and recurring payments](docs/design/scheduled-payments.md) (#246)
- [Version and feature introspection](docs/design/version-introspection.md) (#247)

## Events

| Contract | Topic | Data |
|---|---|---|
| globe-wallet | `initialized` | admin |
| globe-wallet | `admin_transferred` | (old, new) |
| globe-wallet | `asset_added` | (user, asset_code) |
| globe-wallet | `asset_removed` | (user, asset_code) |
| globe-wallet | `spend_limit_set` | (user, asset_code, limit) |
| globe-wallet | `spend_recorded` | (user, asset_code, amount, total, limit) |
| token-wrapper | `approved` | (owner, spender, amount, expiry) |
| token-wrapper | `transfer_from` | (spender, from, to, amount) |

## Related Packages

- [`backend/`](../backend/) — REST API (in this monorepo)
- Web frontend and mobile app — not yet built; see the [root README](../README.md)
