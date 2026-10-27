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
