# Client-side signing (web and mobile)

The backend exposes operation-specific builders that return unsigned XDR. The
client must present the operation and its effects, then ask the user's wallet
to sign with the network passphrase returned by the API. Never send a user's
secret key to the backend.

`GET /api/v1/config` is public and returns the active network passphrase,
Horizon/Soroban URLs, contract IDs, feature availability, and API/client
versions. It does not expose server secrets.

## Native SDKs (Kotlin and Swift)

Besides the TypeScript SDK in `packages/sdk`, native clients are generated from
`backend/openapi.yaml` with openapi-generator:

- Kotlin: `packages/sdk-kotlin` (generated client + hand-written auth/signing layer)
- Swift: `packages/sdk-swift` (generated client + hand-written auth/signing layer)

The generated clients cover transport, models, and error envelopes. The
hand-written layers add bearer-token auth and the signing flow below, mirroring
`packages/sdk`. All three SDKs run the same JSON conformance cases in
`packages/sdk-conformance/cases` so behaviour stays aligned.

## Build and sign a trustline change

`POST /api/v1/wallet/trustline/build` requires authentication and accepts an
account, a non-native asset (`code` and checksum-validated `issuer`), and an
optional decimal-string `limit`. Omit `limit` to use the maximum supported
limit; pass `"0"` to remove an existing zero-balance trustline. Before signing,
show `reserveDelta` and `spendableXlmAfter` to the user. An unsponsored trustline addition locks 0.5 XLM of reserve; removing an
unsponsored trustline releases 0.5 XLM. Removing a sponsored trustline can
have no reserve impact for the account.

```ts
import { signTransaction } from "@stellar/freighter-api";

const response = await fetch("/api/v1/wallet/trustline/build", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({
    account: sourcePublicKey,
    asset: { code: "USDC", issuer: assetIssuer },
  }),
});

if (!response.ok) {
  throw new Error("Could not build the trustline transaction");
}

const build = await response.json();
// Show build.reserveDelta and build.spendableXlmAfter for user confirmation.
const { signedTxXdr, error } = await signTransaction(build.xdr, {
  networkPassphrase: build.networkPassphrase,
});
if (error) throw new Error(error);
```

The backend also exposes `POST /api/v1/contract/wallet/assets/build` and
`POST /api/v1/contract/wallet/assets/remove/build` for the Soroban wallet asset
registry. Those routes return unsigned XDR; native XLM uses
`{ code: "XLM", issuer: null }`.

## Submission

`POST /api/v1/wallet/submit` relays a client-signed envelope, but only one
this API built (#194). Each build endpoint records the hash of the unsigned
transaction with its intent, source account, sequence, network and expiry.
On submit the backend decodes the envelope and matches the (inner)
transaction hash against those records. Signing doesn't change the hash, but
any edit does, so:

- Sign the XDR exactly as returned. Wrapping it in a fee-bump is fine.
- An edited envelope (extra operation, other fee, other destination) is
  refused with `INVALID_TRANSACTION`, reason `ENVELOPE_MODIFIED`.
- A transaction no build endpoint returned is refused with reason
  `NOT_BUILT_BY_API`.
- Past `timeBounds.maxTime` it is `TX_EXPIRED`. Build again.

This keeps the API from acting as an open relay for arbitrary signed
transactions under its rate limits or fee sponsorship. Refusals are counted in
`wallet_submit_rejected_total{reason}` at `GET /api/v1/health/metrics`.

## Wallet signing

Use the network passphrase returned by the build response. For Stellar
Wallets Kit, pass both the XDR and the account selected by the user:

```ts
const { signedTxXdr, error } = await StellarWalletsKit.signTransaction(build.xdr, {
  networkPassphrase: build.networkPassphrase,
  address: sourcePublicKey,
});
if (error) throw new Error(error);
```

Never put a secret key in a web/mobile bundle, request body, log, or telemetry.
The legacy `/send`, `/fee-bump`, path-payment, `/partial-transaction`,
`/contract/wallet/spend`, and `/keypair` routes are deprecated and emit
`Deprecation`, `Sunset`, and `Link` headers. See the migration table in the
[backend README](../README.md#legacy-secret-key-route-migration).
