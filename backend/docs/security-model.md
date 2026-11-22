# Security Model: Secret Key Handling

> **Note:** For the complete system-wide STRIDE threat model spanning the Soroban smart contracts, backend API, `@globe-wallet/sdk`, and future web/mobile clients (including key-compromise playbooks for user, admin, guardian, and backend keys), see **[`docs/threat-model.md`](../../docs/threat-model.md)** (#238). This document remains the detailed historical reference for the backend's transition from custodial to client-side signing.

## Overview

This document specifies how this backend handles secret key material, what guarantees are provided today, and the intended long-term architecture. This is a high-stakes design decision — secret keys control real funds on Stellar — and needs to be explicit rather than implicit.

**Executive summary:** This service currently implements **custodial signing** — it accepts raw secret keys in the request body and uses them to sign and submit transactions. This is the intended transient architecture; a future migration path toward **client-side signing** (backend receives only pre-signed XDR) is explicitly called out below, with partial-transaction and multisig endpoints serving as prior art for that pattern.

## Service Secrets: Management and Rotation

Beyond user-supplied keys, the backend depends on long-lived service secrets (JWT signing keys, sponsor keys, SMTP credentials). These are configured via environment variables and, on Render, declared in `render.yaml`. This section documents how they are managed and rotated.

### Secret provider abstraction

Service secrets are resolved through a provider abstraction (`backend/src/config.ts`) so the same code path works across environments:

- **`env`** — read from process environment (local dev, testnet). Default.
- **`vault`** — HashiCorp Vault KV v2, selected with `SECRET_PROVIDER=vault`.
- **`aws-sm`** — AWS Secrets Manager, selected with `SECRET_PROVIDER=aws-sm`.

Each provider exposes the same `get(name)` / `refresh()` contract. Secrets are fetched once at boot and cached in memory; the cache is refreshed on a timer (`SECRET_REFRESH_INTERVAL_MS`, default 5 minutes) so rotated values are picked up **without a redeploy**.

### Hot reload

On each refresh the provider re-reads the secret set and swaps the in-memory cache atomically. Consumers read through the cache, so a rotation takes effect on the next request after the refresh interval — no restart, no downtime. If a refresh fails, the previous cache is retained and the failure is logged; the service keeps serving with the last-known-good secrets rather than crashing.

### Sponsor keys and KMS

Sponsor keys are the highest-value service secrets (they pay fees and can be abused to drain the sponsor account). They are **not** stored as plaintext env vars in production. Instead:

- The sponsor **public** key is configured normally (`SPONSOR_PUBLIC_KEY`).
- The sponsor **secret** lives in a KMS (AWS KMS or Vault Transit). The backend never sees the raw key; it calls the KMS `sign` API with the transaction hash and receives a signature, which it attaches to the transaction (remote signing).
- The KMS key policy restricts `Sign` to the backend's IAM role; `Decrypt`/`GetPrivateKey` are not granted.

This means a leak of the backend's environment does not expose the sponsor secret, and rotating the sponsor key is a KMS key-rotation operation rather than a redeploy.

### Rotation runbook

1. **Generate** the new secret value (e.g. `openssl rand -base64 48` for JWT keys).
2. **Write** it to the provider under the same secret name (Vault `kv put`, or `aws secretsmanager put-secret-value`). Do not delete the old version yet.
3. **Wait** one refresh interval (`SECRET_REFRESH_INTERVAL_MS`) for the cache to pick up the new value. Confirm via the `/health` secret-provider status.
4. **Verify** the service is healthy and signing with the new value (JWT: issue + verify a token; sponsor: submit a testnet transaction).
5. **Revoke** the old version in the provider once all instances have refreshed.
6. **Record** the rotation (who, when, which secret) in the ops log.

For sponsor keys, steps 1–2 are replaced by a KMS key rotation; the backend picks up the new key version automatically on the next signing call.

### Failure modes

- **Provider unreachable at boot:** the service fails fast rather than starting with missing secrets.
- **Provider unreachable during refresh:** the last-known-good cache is retained; the failure is logged and surfaced in health checks.
- **Rotated secret invalid:** the service continues with the old value until the new one validates, preventing a bad rotation from taking the service down.

## Current Architecture: Custodial Signing

### What it looks like

Every state-changing wallet endpoint accepts a raw Stellar secret key:

- `POST /api/v1/wallet/send` — `sourceSecretKey`
- `POST /api/v1/wallet/fee-bump` — `feeSecretKey`
- `POST /api/v1/wallet/path-payment-strict-send` — `sourceSecretKey`
- `POST /api/v1/wallet/path-payment-strict-receive` — `sourceSecretKey`
- `POST /api/v1/wallet/submit-multisig` — `signerSecretKeys[]`
- `POST /api/v1/contract/wallet/spend` — `userSecretKey`

Each request includes:

```json
{
  "sourceSecretKey": "S...", // Raw plaintext 56-character secret key
  "destinationPublicKey": "G...",
  "amount": "100.00"
}
```

The backend then:

1. **Receives** the key in the request body (protected by TLS at the network boundary)
2. **Instantiates** a keypair from it: `StellarSdk.Keypair.fromSecret(sourceSecretKey)` (src/services/stellar.ts:146, repeated in every write operation)
3. **Signs** the transaction using the keypair
4. **Submits** the signed transaction to Horizon

### Threat model: What is defended against

- **Network eavesdropping:** TLS (assumed to be configured by the deployment environment) encrypts the request body in transit. An attacker cannot extract the key from network traffic.
- **Request/response logging:** Morgan middleware is configured with the default format (`"combined"`), which does not log request bodies. The key never appears in application or server logs.
- **Horizon communication:** After signing, the backend sends the **signed transaction** (not the secret key) to Horizon. Only the public key is exposed to the Horizon API.

### Threat model: What is NOT defended against

#### 1. Process memory exposure

A Stellar secret key, once instantiated as a V8 string in the Node process, remains in memory for the duration of the request. The JavaScript runtime does not automatically zero-out sensitive strings, and V8 strings are immutable — a value may persist in memory pages even after the request completes and the reference is dereferenced, until garbage collection reclaims it.

**Failure scenarios:**

- **Process crash + core dump:** If the Node process crashes while processing a request with an active secret key, and the deployment environment does not disable core dumps, an attacker with filesystem access to the crashed process's core file can extract the plaintext key.
- **Memory forensics:** An attacker with physical or administrative access to a running process (e.g., via a container escape, unpatched OS vulnerability, or malicious sidecar) can read the process's memory and extract the key, even if it's not currently being used.
- **Third-party memory access:** A compromised transitive dependency (one of the many packages in `node_modules` that this service imports) could read process memory. This service imports @stellar/stellar-sdk, jsonwebtoken, redis, pg, and their transitive trees — any of them, or a supply-chain attack on them, could theoretically exfiltrate process memory.

#### 2. Key in request/response logs (misconfiguration risk)

While Morgan's default format does not log bodies, this is not enforced in code. A future contributor who changes the format string to something like `morgan(':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] - :req[body]')` would silently log secret keys to stdout. This risk exists because the guarantee is implicit, not explicit and tested.

#### 3. Key storage and caching

This design does not store keys at rest — they exist only for the duration of a single request. However, if caching were added (e.g., a feature to store keys in Redis for a session), the cached representation would be as exposed as the plaintext key in transit, with additional attack surface (Redis persistence to disk, replication over the network, etc.).

## Future Architecture: Client-Side Signing

### What it would look like

Rather than receiving a secret key, the backend would receive a pre-signed transaction:

```json
{
  "xdr": "AAAAAgAAAAB...",  // Unsigned XDR as a string
  "signatures": [
    "000...50-character-base64-encoded-signature..."
  ]
}
```

Or, building partially unsigned then signing externally:

```json
{
  "xdr": "AAAAAgAAAAB...",  // Unsigned or partially-signed XDR
  "signatures": ["base64-encoded-signature-1", "base64-encoded-signature-2"]
}
```

The backend would:

1. **Deserialize** the XDR to a Transaction object
2. **Verify** that the provided signatures are valid for the transaction (cryptographic verification, not key storage)
3. **Submit** the signed transaction to Horizon

The secret key never enters the backend. It lives only on the client.

### Prior art in this codebase

This pattern already exists and is proven:

- **`POST /api/v1/wallet/partial-transaction`** (`src/services/stellar.ts:buildPartialTransaction`) builds an unsigned transaction and returns its XDR. The caller (client-side code) signs it with their secret key and submits it elsewhere, or...
- **`POST /api/v1/wallet/submit-multisig`** (`src/services/stellar.ts:submitWithAdditionalSignatures`) accepts a transaction XDR and an array of secret keys to add signatures. This is the multisig equivalent of the flow above and demonstrates the pattern working in practice.

Both of these endpoints show that the backend is already comfortable with "build unsigned → sign externally → submit here" workflows. The architecture has a proven foundation for moving the primary `/send` endpoint to the same model.

### Why this matters

Advantages of client-side signing:

- **Keys never leave the client.** The client holds the secret key, signs locally, and sends only the signed transaction to the backend. If the backend is compromised, keys are not at risk.
- **Reduced backend attack surface.** No need to worry about core dumps, process memory, or transitive dependencies exfiltrating keys, because the keys were never there.
- **Better separation of concerns.** The backend becomes a transaction submitter and observer, not a signer. It can be scaled and run in untrusted environments with significantly lower risk.
- **Foundation for hardware wallets / mobile signers.** A client-side signing architecture makes it easier to integrate with hardware wallets, mobile devices, and other secure enclaves that hold keys offline.

Disadvantages and migration challenges:

- **API contract change.** Every client of `/send` would need to be updated to construct and sign the transaction locally before calling the backend. This is not a smooth migration.
- **Transaction construction on the client.** Clients must implement or import Stellar transaction-building logic. This is possible (there are JS and mobile SDKs) but adds complexity to client code.
- **Timebound transactions.** Un

/* … truncated 10236 chars — edit only what you need near the top … */
