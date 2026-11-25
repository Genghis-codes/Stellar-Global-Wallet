# Stellar Global Wallet SDK

Typed, framework-agnostic client for the Stellar Global Wallet API. Works in Node,
browsers and React Native (no Node-only modules in the runtime path).

## Install

```bash
npm install @globe-wallet/sdk
```

## Quick start

```ts
import { createClient, InMemoryTokenStore } from '@globe-wallet/sdk';

// After sign-in (POST /api/v1/auth/login or the SEP-10 /auth/token flow),
// store both tokens; the client attaches the access token and refreshes it.
const tokenStore = new InMemoryTokenStore();
tokenStore.set({ accessToken, refreshToken });

const client = createClient({
  baseUrl: 'http://localhost:4000',
  tokenStore,
  onSessionExpired: () => {
    // refresh token expired or was revoked — send the user back to sign in
  },
});
```

`createClient` returns an `ApiClient` for the REST API. (The `Client` export
is the generated Soroban contract client; see `createGlobeWalletClient`.)
Errors are thrown as `ApiError` with `status`, `code` and `message` taken
from the backend's `{ error: { code, message } }` envelope.

## Token storage

The SDK never persists tokens itself. Supply a `TokenStore` that matches the
storage rules of your platform:

```ts
export interface TokenStore {
  get(): Promise<AuthTokens | null> | AuthTokens | null;
  set(tokens: AuthTokens): Promise<void> | void;
  clear(): Promise<void> | void;
}
```

`InMemoryTokenStore` is the default and is suitable for Node and short-lived
sessions. It does **not** survive a reload.

| Platform | Recommended store | Lifetime / rules |
| --- | --- | --- |
| Node (server, CLI) | `InMemoryTokenStore` | Process lifetime; re-authenticate on restart. |
| Web | `localStorage` / `sessionStorage` adapter | Access tokens are short-lived (see `utils/jwt.ts`). Prefer `sessionStorage` unless the user opted into "stay signed in"; never store tokens in a cookie readable by third-party scripts. |
| React Native | `expo-secure-store` adapter | Persist in the OS keychain/keystore. Clear on sign-out and on `onSessionExpired`. |

Access tokens are short-lived by design. Refresh tokens rotate on every use, so
the SDK refreshes them **single-flight**: all in-flight requests share one
`refresh()` promise, and parallel `401 TOKEN_EXPIRED` responses trigger exactly
one call to `/api/v1/auth/refresh`, which sends the stored refresh token and
saves the rotated pair it returns.

## Automatic refresh and retry

When a request fails with `401` and error code `TOKEN_EXPIRED`, the SDK:

1. awaits the shared single-flight `refresh()` (one call, no matter how many
   requests are waiting),
2. replays the original request once with the new access token.

A plain `401 UNAUTHORIZED` is **not** retried — it surfaces to the caller.

If the refresh token itself is expired or revoked, the SDK clears the
`TokenStore` and invokes `onSessionExpired`, then rejects with a typed
`SessionExpiredError`:

```ts
import { SessionExpiredError } from '@globe-wallet/sdk';

try {
  await client.request('/api/v1/account/G.../balances');
} catch (err) {
  if (err instanceof SessionExpiredError) {
    // tokens were cleared; prompt the user to sign in again
  }
}
```

Requests aborted while waiting for a refresh reject with the abort reason and do
not consume the refreshed token.

### Rate limiting and transient failures

`429` and `503` responses are retried with exponential backoff plus jitter,
honouring the `Retry-After` header when present. Non-idempotent `POST` requests
are only retried when an `Idempotency-Key` header is supplied, so a retry can
never create a duplicate resource.

```ts
await client.request('/api/v1/wallet/submit', {
  method: 'POST',
  body: { signedXdr },
  idempotencyKey: crypto.randomUUID(),
});
```

## Errors

All failures reject with typed errors from the SDK error-code catalogue, so
callers can branch on `code` instead of parsing messages.

## Signed manifests

Contract ids and network URLs from the API are only trusted after the
manifest's ed25519 signature checks out against a release key pinned in the
app. A tampered or unsigned manifest throws `ManifestVerificationError`.

```ts
import { verifySignedManifest } from '@globe-wallet/sdk';

const PINNED_KEYS = ['GRELEASE...']; // add the next key here before rotating
const manifest = verifySignedManifest(await res.json(), PINNED_KEYS);
```

Release tooling signs with the offline key via
`signManifest(manifest, process.env.MANIFEST_SIGNING_SECRET)`. To rotate,
ship the new public key next to the old one, switch signing to the new key,
then remove the old key in a later release.

## Hardware wallet signing (Ledger)

The SDK can sign transaction envelopes and Soroban authorization entries with a
Ledger device running the Stellar app. Signing is decoupled from the transport
via a small `LedgerTransport` interface, so the same signing code works over
WebHID (browser) and BLE (mobile).

```ts
import {
  createLedgerSigner,
  WebHidTransport,
  BleTransport,
} from '@globe-wallet/sdk';

// Browser: WebHID. Mobile: BLE (React Native).
const transport = new WebHidTransport(); // or new BleTransport({ deviceId })
const signer = createLedgerSigner({
  transport,
  // BIP-32 path for the Stellar account, e.g. m/44'/148'/0'
  path: "44'/148'/0'",
});

await signer.connect();
const publicKey = await signer.getPublicKey();

// Sign a transaction envelope (base64 XDR). Returns the signed envelope XDR.
const signedXdr = await signer.signTransaction(envelopeXdr, {
  networkPassphrase: Networks.TESTNET,
});

// Sign a Soroban authorization entry (base64 XDR of the entry).
const signedAuthEntry = await signer.signAuthEntry(authEntryXdr, {
  networkPassphrase: Networks.TESTNET,
});

await signer.disconnect();
```

### Transport abstraction

```ts
export interface LedgerTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Send an APDU command and resolve with the response payload. */
  exchange(apdu: Uint8Array): Promise<Uint8Array>;
}
```

`WebHidTransport` wraps `navigator.hid`; `BleTransport` wraps the platform BLE
stack (e.g. `react-native-ble-plx`). Both are thin adapters — the Stellar app
protocol (APDU framing, chunked payloads, user confirmation) lives in the
signer, so new transports only need to implement `exchange`.

### Failure modes

- **Device locked / app not open** — `connect()` and signing reject with
  `LedgerDeviceError` (`code: 'DEVICE_UNAVAILABLE'`). Prompt the user to unlock
  the device and open the Stellar app.
- **User rejected** — signing rejects with `LedgerUserRejectedError`
  (`code: 'USER_REJECTED'`). Do not retry automatically.
- **Wrong network** — the signer verifies the network passphrase before
  signing and rejects with `LedgerNetworkMismatchError`.
- **Transport lost mid-sign** — rejects with `LedgerTransportError`; the
  envelope is left unsigned and safe to retry.

### Testing with Speculos

Signing is tested against the [Speculos](https://github.com/LedgerHQ/speculos)
emulator. Start the emulator with the Stellar app, then point the test transport
at its APDU socket:

```bash
speculos --model nanosp --display headless \
  --apdu-port 9999 apps/stellar.elf
```

```ts
import { SpeculosTransport } from '@globe-wallet/sdk/testing';

const signer = createLedgerSigner({
  transport: new SpeculosTransport({ host: '127.0.0.1', port: 9999 }),
  path: "44'/148'/0'",
});

const signed = await signer.signTransaction(envelopeXdr, {
  networkPassphrase: Networks.TESTNET,
});
// `signed` is a valid envelope XDR whose signature verifies against
// `await signer.getPublicKey()`.
```

`SpeculosTransport` implements the same `LedgerTransport` interface, so the
emulator exercises the exact signing path used in production.

## Key management

The SDK exposes a pluggable `Keystore` interface so web, React Native, and
hardware-wallet integrations can sign transactions and Soroban authorization
entries without exporting private key material:

- **`WebCryptoKeystore`** (Web) — generates or imports Ed25519 keys with
  `extractable: false` and persists `CryptoKey` handles in IndexedDB. Raw
  private key bytes never leave WebCrypto.
- **`ExpoSecureStoreKeystore`** (React Native) — stores secret seeds in OS
  Keychain / Keystore via `expo-secure-store` (with optional
  `requireAuthentication`) while keeping only public descriptors in the index.
- **`HardwareWalletKeystore`** — delegates signing to a `HardwareWalletDevice`
  and verifies returned signatures and envelope hashes locally before returning.
- **`withBiometricGate`** — wraps any `Keystore` with fail-closed biometric
  gating hooks (`isAvailable`, `authenticate`, `onAuthorized`, `onDenied`) and
  an optional `unlockWindowMs` cleared via `lock()`.
- **`toStellarSigner`** — adapts any `Keystore` into a `Signer` compatible
  with `createGlobeWalletClient`.

```ts
import {
  WebCryptoKeystore,
  withBiometricGate,
  toStellarSigner,
  createGlobeWalletClient,
  Networks,
} from '@globe-wallet/sdk';

const baseStore = new WebCryptoKeystore();
await baseStore.generateKey({ label: 'Primary' });

const keystore = withBiometricGate(baseStore, {
  authenticate: async ({ operation }) => ({
    verified: await promptUserBiometric(operation),
  }),
});

const signer = await toStellarSigner(keystore, {
  networkPassphrase: Networks.TESTNET,
});

const client = createGlobeWalletClient('testnet', {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  publicKey: signer.address,
  signTransaction: signer,
  signAuthEntry: signer,
});
```
