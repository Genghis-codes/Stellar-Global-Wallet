# Security Model: Secret Key Handling

## Overview

This document specifies how this backend handles secret key material, what guarantees are provided today, and the intended long-term architecture. This is a high-stakes design decision — secret keys control real funds on Stellar — and needs to be explicit rather than implicit.

**Executive summary:** This service currently implements **custodial signing** — it accepts raw secret keys in the request body and uses them to sign and submit transactions. This is the intended transient architecture; a future migration path toward **client-side signing** (backend receives only pre-signed XDR) is explicitly called out below, with partial-transaction and multisig endpoints serving as prior art for that pattern.

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
- **Timebound transactions.** Unsigned transactions are only valid for a limited time window (default 30 minutes in Stellar). If the client takes too long to sign and submit, the transaction expires and must be rebuilt. This is manageable but adds operational complexity.

### Migration path (if chosen)

If the team decides to migrate to client-side signing:

1. **Phase 1: Add client-side signing as an option.** Create a new endpoint (e.g., `POST /api/v1/wallet/send-signed`) that accepts a pre-signed XDR. Run both endpoints in parallel.
2. **Phase 2: Deprecate custodial endpoints.** Add deprecation warnings to existing endpoints and communicate the timeline to API clients.
3. **Phase 3: Sunset custodial endpoints.** Remove the old endpoints once all clients have migrated.

Alternatively, a breaking API version change (v2) could bundle the migration if the team prefers a cleaner break.

## Current State: Explicit Guarantees and Gaps

### Guarantees provided today

1. **TLS in transit.** Request bodies are encrypted in transit to the backend (TLS assumed to be deployed). The secret key does not cross the network in cleartext.
2. **No body logging.** Morgan is configured to not log request bodies. Secret keys do not appear in application or server logs by default. *(Caveat: This is implicit, not explicitly enforced in code — see "Gaps" below.)*
3. **No key storage.** Keys are not cached, stored to disk, or persisted to external services. They exist only during request processing.
4. **Single-use per request.** Each request that includes a secret key uses that key for exactly one signing operation, then the reference is released.

### Gaps and risks

1. **No explicit, tested guarantee against body logging.** Morgan's default format happens to not log bodies, but this isn't validated by tests or enforced in code. A future contributor could change the format without realizing they're now logging keys.
   - **Mitigation:** Add a test that confirms Morgan is not logging request bodies. Document the format string as a security-sensitive config.

2. **No mitigation for process memory exposure.** If the backend process crashes or is compromised, keys in memory are at risk until garbage collection reclaims them.
   - **Partial mitigation (not in place):** Some platforms support explicit memory-zeroing (e.g., `sodium.memzero` in libsodium for other languages). JavaScript runtime does not provide this for strings. This could be researched but may not be implementable within Node's constraints.
   - **Better mitigation:** Migrate to client-side signing so keys never enter the backend process.

3. **Supply-chain risk is implicit.** This service depends on many transitive dependencies. Any of them could theoretically read process memory or intercept secret keys. There is no explicit policy about dependency vetting, pinning, or supply-chain hardening.
   - **Mitigation:** Treat dependency updates as security-sensitive changes; audit new dependencies for memory access or suspicious behavior. Consider using `npm audit` regularly. (This is standard practice, not specific to this service, but worth documenting.)

4. **No explicit validation that keys are not logged to external services.** If a third-party logging service (e.g., Datadog, CloudWatch) is integrated in the future, it could accidentally log request bodies or errors that include keys.
   - **Mitigation:** If external logging is added, explicitly sanitize request/response bodies to redact fields named `*[Ss]ecret[Kk]ey*`, `*[Ss]igner[Ss]*`, etc.

## Recommendations

### Short term (maintain current architecture, reduce risks)

1. **Add a test that validates Morgan is not logging request bodies.** This makes the guarantee explicit and prevents regression if the format changes.
   ```js
   // In a new test file, e.g., tests/middleware/morgan-no-body-logging.test.ts
   // Fire a request with a secret key, capture logs, verify the key is not present
   ```

2. **Document the deployment's responsibility for core dumps.** Add a section to this document or a new security/deployment guide addressing:
   - Disable core dumps in production (Linux: `ulimit -c 0`, systemd: `LimitCORE=0`)
   - Use memory-locked containers or OS-level hardening if available
   - Monitor for unexpected process exits and investigate core files

3. **Audit the default transitive dependencies.** Review the security posture of major dependencies (@stellar/stellar-sdk, jsonwebtoken, redis, pg). Look for any history of supply-chain incidents or suspicious memory access patterns.

4. **Establish a policy: dependency updates are security-reviewed.** When updating dependencies, check changelog for suspicious changes or known vulnerabilities.

### Medium term (prepare for migration path)

1. **Ensure `buildPartialTransaction` and `submitWithAdditionalSignatures` are well-tested and documented.** These are the pattern for client-side signing; they should be the first endpoints clients learn.

2. **Add a design doc for the client-side migration if/when the team decides to pursue it.** This would be a separate issue with its own requirements. For now, document that the option exists.

### Long term (consider migration to client-side signing)

If the team prioritizes defense-in-depth for key material:

1. **Evaluate whether client-side signing is feasible for the use case.** Some workflows (e.g., a service that needs to auto-approve payments) may not be compatible. Others may need a hybrid (some keys client-signed, others held server-side).

2. **If feasible, plan a migration.** Create endpoints for client-side signing, deprecate custodial endpoints, migrate clients, and sunset old endpoints.

## FAQ

### Q: Is the current design insecure?

**A:** It's not inherently insecure, but it does centralize key material in the backend, which is inherently higher-risk than not holding keys at all. The design is acceptable for services where:

- TLS is reliably deployed and monitored
- The backend is trusted infrastructure (not a third-party SaaS)
- Core dumps and process memory are protected by OS-level hardening
- Key storage is transient (keys are not cached, persisted, or replicated)

This service likely meets these criteria, but should verify them as part of deployment.

### Q: Can you mitigate key-in-memory risks without migrating to client-side signing?

**A:** Partially. Options that do NOT fully solve the problem but reduce risk:

- **Memory-locked containers:** Some container runtimes support memory locking (e.g., `--memory-swappiness=0`, `--cap-drop=all` for reduced attack surface). This prevents keys from being written to disk in swap and from being accessible to non-root processes, but not from a crash dump or root-level access.
- **Explicit key erasure:** Some language runtimes support this (e.g., Rust's `zeroize` crate). JavaScript's V8 does not offer a public API for string zeroing. There are community efforts to add this, but nothing in stable production use yet.
- **Reduced request window:** Minimize the time a key lives in memory by optimizing request handling (e.g., async/await without unnecessary delays). This is good practice anyway but doesn't eliminate the risk.

None of these fully eliminate the risk without migrating to client-side signing.

### Q: What if we need to support custodial signing forever?

**A:** That's a valid choice. If custodial signing is the long-term architecture:

1. Update this document to reflect that decision and the rationale.
2. Implement the short-term mitigations above (test for body logging, core dump hardening, dependency auditing).
3. Treat this as a high-security service in operational policies: restricted deployment, regular security audits, incident response procedures for any process compromise, etc.

### Q: What about JWT tokens for accounts? Are they at the same risk?

**A:** JWT tokens are credentials, not signing keys. They control access but do not move funds directly (the secret key does). Tokens should still be protected (TLS, no body logging, etc.), but the failure scenario is different: a compromised token is equivalent to a compromised account credential, not direct theft of signing authority. This is a separate threat model and is addressed by the jwtAuth middleware and related practices.

## References

- **Stellar SDK for JavaScript**: [stellar-sdk on npm](https://www.npmjs.com/package/@stellar/stellar-sdk)
- **Concurrency and sequence number safety**: See `docs/concurrency.md` in this repo
- **Multisig and partial transaction endpoints**: Examples of the client-side signing pattern already in use

## Document version

- **Version:** 1.0
- **Last updated:** 2026-08-23
- **Author:** GlobeWallet team
- **Status:** Approved — this is the official security model until superseded by a later update

---

## Appendix: Example of the Alternative (Client-Side Signing Flow)

For reference, here's what a client-side signing flow would look like:

### Today: Custodial (backend signs)

```js
// Client sends secret key
POST /api/v1/wallet/send {
  "sourceSecretKey": "S...",
  "destinationPublicKey": "G...",
  "amount": "100"
}

// Backend: receives key, instantiates keypair, signs, submits
const keypair = StellarSdk.Keypair.fromSecret(sourceSecretKey);
const tx = builder.build();
tx.sign(keypair);
await submitTransaction(tx);
```

### Future: Client-side (client signs)

```js
// Client: build transaction
const tx = builder.build();
const xdr = tx.toEnvelope().toXDR('base64');

// Client: sign locally (or via hardware wallet)
const keypair = StellarSdk.Keypair.fromSecret(sourceSecretKey); // only on client
const hash = tx.hash();
const signature = keypair.sign(hash);

// Client sends only signed transaction
POST /api/v1/wallet/send-signed {
  "xdr": "AAAAAgAAAAB...",
  "signatures": ["base64-encoded-signature"]
}

// Backend: verify signature, submit (no key ever received)
const tx = StellarSdk.TransactionEnvelope.fromXDR(xdr, 'base64');
// Verify signatures are valid for the tx
await submitTransaction(tx);
```

This pattern is already implemented in the codebase via `/partial-transaction` (build unsigned) and `/submit-multisig` (verify and submit). Moving `/send` to the same pattern is a straightforward extension of existing code.
