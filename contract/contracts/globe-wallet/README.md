# Globe Wallet Contract

Soroban smart contract backing the Stellar Global Wallet. It tracks per-user
balances, assets, and transfer limits, and exposes read/write entry points used
by the backend and SDK.

## Assets

Assets are identified by **type**, not by their code string:

- **Native** — lumens (XLM). There is exactly one native asset.
- **Issued** — any asset with a `code` and an `issuer` (e.g. USDC, or an issued
  token whose code happens to be `XLM`).

> **Important:** an issued asset whose code is `"XLM"` is **not** native. Only
the native asset type is treated as lumens. Issued `XLM` tokens (which exist on
mainnet as scam/mimic assets) are tracked as ordinary issued assets and are
subject to the same limits and accounting as any other issued asset.

When adding an asset, the contract distinguishes native from issued by the
presence of an issuer: a code of `"XLM"` **with** an issuer is an issued asset,
never native. Do not rely on the code string alone to detect lumens.

## Migration

Previously stored asset state that inferred "native" from the code string
`"XLM"` is migrated so that native is determined by asset type. Any entry that
carried an issuer is reclassified as an issued asset; only the issuer-less
native entry remains native.

## Development

```bash
cd contract
cargo test --workspace
```
