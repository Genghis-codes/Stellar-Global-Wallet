# Frontend architecture

How the GlobeWallet web app is organised, and the conventions to follow when
adding features. Read this before adding a page, an API module or a hook.

## Stack

- **Next.js App Router** (`src/app`), React 19, TypeScript in strict mode
  (`noUncheckedIndexedAccess` on).
- **Tailwind CSS v4** with semantic theme tokens (`src/app/globals.css`).
- **TanStack Query** for all server state. No other global store.
- **@stellar/stellar-sdk 17** (same major as the backend) and
  **@stellar/freighter-api** for wallet connection and signing.
- **Vitest + Testing Library** (jsdom) for unit and component tests.

## Folder layout

```
frontend/
├─ src/
│  ├─ app/                      Routes only: pages, layouts, boundaries
│  │  ├─ layout.tsx             Root layout (theme init script, <Providers>)
│  │  ├─ providers.tsx          QueryClient → Theme → Toast → Auth providers
│  │  ├─ page.tsx               Public landing / "Connect Freighter"
│  │  ├─ not-found.tsx, error.tsx, global-error.tsx
│  │  └─ (app)/                 Signed-in area (route group, no URL segment)
│  │     ├─ layout.tsx          RequireAuth + AppShell + AccountMenu
│  │     ├─ loading.tsx, error.tsx
│  │     └─ dashboard/page.tsx
│  ├─ components/
│  │  ├─ ui/                    Design system primitives (+ index.ts barrel)
│  │  ├─ layout/                AppShell, Sidebar, Topbar, PageHeader, ErrorFallback
│  │  ├─ theme/                 ThemeProvider, ThemeToggle
│  │  ├─ auth/                  AuthProvider/useAuth, RequireAuth, ConnectWallet, AccountMenu
│  │  ├─ dashboard/             Feature components for the dashboard page
│  │  └─ icons.tsx              Inline SVG icons (24×24, stroke, currentColor)
│  ├─ config/nav.ts             Sidebar / drawer navigation items
│  ├─ hooks/                    React Query hooks and other shared hooks
│  ├─ lib/
│  │  ├─ api/                   HTTP client, errors, tokens, CSRF, endpoint modules
│  │  │  └─ endpoints/          One typed module per backend route group
│  │  ├─ auth/sep10.ts          SEP-10 sign-in / sign-out flow (framework-free)
│  │  ├─ wallet/                WalletAdapter interface + Freighter adapter
│  │  ├─ stellar/               Network passphrases, explorer links, amounts, assets
│  │  ├─ query/                 QueryClient factory and query-key factory
│  │  ├─ env.ts                 Typed NEXT_PUBLIC_* config
│  │  ├─ format.ts              Address/amount/fiat display formatting
│  │  └─ cn.ts                  className joiner
│  └─ test/                     Test setup and helpers (mock fetch, render wrapper)
├─ .env.example
├─ eslint.config.mjs, vitest.config.mts, next.config.ts, tsconfig.json
└─ README.md
```

Rule of thumb: `app/` holds routing files only, `components/` holds UI,
`lib/` holds framework-free logic (no React imports outside `lib/query`),
`hooks/` glues `lib/` to React.

## Conventions

### Naming

- Components: `PascalCase.tsx`, one exported component per file (small
  sub-components may live alongside). Named exports, no default exports,
  except Next.js route files (`page.tsx`, `layout.tsx`, ...) which must
  default-export.
- Hooks: `useThing.ts` in `src/hooks/` (or next to a feature component if
  only that feature uses it).
- Library modules: `camelCase.ts`.
- Tests sit **next to the file they test**: `Button.tsx` → `Button.test.tsx`,
  `client.ts` → `client.test.ts`. Vitest picks up `src/**/*.test.{ts,tsx}`.
- Import with the `@/` alias (`@/components/ui`, `@/lib/api`), never with
  long relative paths across folders.

### Styling

- Use only the semantic colour utilities from the theme: `bg-background`,
  `bg-surface`, `bg-surface-muted`, `text-fg`, `text-fg-muted`, `border-border`,
  `bg-primary` / `text-primary-fg` / `hover:bg-primary-hover`, and
  `success|warning|danger|info` with their `-soft` backgrounds. Never raw
  palette colours (`bg-blue-500`), or dark mode breaks.
- Dark mode is class based (`.dark` on `<html>`), driven by ThemeProvider.
  New tokens go in `globals.css` in both `:root` and `.dark`, plus `@theme inline`.
- Compose classes with `cn()` and accept a `className` prop on reusable components.

### Design system (`components/ui`)

Button, Spinner, Input, Card (CardHeader/CardBody/CardFooter), Badge,
Skeleton/SkeletonText, EmptyState, Modal, Toast (`ToastProvider`,
`useToast`), Tabs, CopyButton, AddressDisplay, AmountDisplay.
Import from the barrel: `import { Button, Card } from "@/components/ui";`.
Add a new primitive here only if it is generic; feature-specific
components go in `components/<feature>/`. Export new primitives from
`components/ui/index.ts`.

- Show Stellar addresses with `AddressDisplay` and amounts with
  `AmountDisplay` (string-based, never `Number`) so formatting is consistent.
- User feedback: `useToast().show({ title, description, tone })`. Use a
  stable `id` for toasts that may repeat.

### Pages and navigation

To add a signed-in page:

1. Create `src/app/(app)/<route>/page.tsx`. It inherits the auth guard, the
   shell, `loading.tsx` and `error.tsx`. Keep it thin: export `metadata`
   and render a client view component from `components/<feature>/`.
2. Start the view with `<PageHeader title=... description=... actions=... />`.
3. Add it to the nav in `src/config/nav.ts`:
   ```ts
   { href: "/activity", label: "Activity", icon: ActivityIcon, match: ["/tx"] }
   ```
   Add the icon to `components/icons.tsx` in the same style. `match` lists
   extra path prefixes that should highlight the item.

Public pages (no session) go directly under `src/app/`, outside `(app)`.

### API layer (`lib/api`)

- `createApiClient` (`client.ts`) wraps fetch: base URL from
  `NEXT_PUBLIC_API_URL`, JSON in/out, `credentials: "include"`, request timeout
  (`TIMEOUT`), network errors (`NETWORK_ERROR`), caller abort (`ABORTED`).
- Every non-2xx response becomes an `ApiError` (`errors.ts`) mapped from the
  backend envelope `{ error: { code, message, details?, retryable?, requestId } }`.
  Branch on `error.code`, not on messages. `describeError(err)` gives a
  user-facing sentence.
- Auth: the bearer access token is attached automatically (`auth: false` to
  skip). On `401 TOKEN_EXPIRED` the client refreshes once via
  `POST /api/v1/auth/refresh` (single flight, since the backend rotates refresh
  tokens) and retries. If refresh fails, or on `SESSION_REVOKED` /
  `AUTH_TOKEN_INVALID`, it clears the session, fires `onSessionExpired`
  (AuthProvider shows a toast) and throws `SESSION_EXPIRED`.
- CSRF: on POST/PUT/PATCH/DELETE the client sends `X-CSRF-Token` from the
  `gw_csrf` cookie or the token remembered from `GET /auth/csrf`
  (`client.ensureCsrfToken()`).
- Tokens live in `sessionStorage` (`tokenStore`), so a session ends with the tab.
- The app-wide instances are in `lib/api/index.ts`: `apiClient`, `tokenStore`, `api`.

#### Adding an API module

1. Read the backend route file (`backend/src/routes/<group>.ts`) and the
   service types it returns. Never invent endpoints or fields.
2. Create `src/lib/api/endpoints/<group>.ts`:
   ```ts
   import type { ApiClient } from "../client";

   /** /api/v1/<group> — what it is (backend/src/routes/<group>.ts). */
   export interface ThingResponse { ... }   // mirror the backend response

   export function thingApi(client: ApiClient) {
     return {
       get(id: string, signal?: AbortSignal) {
         return client.get<ThingResponse>(`/api/v1/things/${encodeURIComponent(id)}`, { signal });
       },
       create(body: CreateThing) {
         return client.post<ThingResponse>("/api/v1/things", body);
       },
     };
   }
   export type ThingApi = ReturnType<typeof thingApi>;
   ```
   - Accept an optional `AbortSignal` on reads (React Query passes one).
   - Pass `auth: false` for public routes; keep the default for `jwtAuth` routes.
   - Unwrap single-key envelopes (`{ flags }`, `{ preferences }`) inside the module.
   - Shared shapes (`Page<T>`, `PageQuery`) are in `lib/api/types.ts`.
3. Register it in `lib/api/index.ts` (`api.things = thingApi(apiClient)`).
4. Add `endpoints/<group>.test.ts` using `mockFetch` / `jsonResponse` /
   `errorResponse` from `@/test/fetch`: assert the URL, method, body and the
   parsed result.

### Data fetching (React Query)

- All query keys come from `lib/query/keys.ts`, shaped
  `[domain, scope?, ...params]`. Account data is scoped by account id, so
  `invalidateQueries({ queryKey: queryKeys.account.all(id) })` refreshes
  everything for that account after a transaction. Add a domain there when
  you add an API module.
- Wrap queries in hooks in `src/hooks/` (`useAccountReserves`,
  `useFeatureFlags`, ...): `queryFn: ({ signal }) => api.x.y(arg, signal)`,
  and `enabled: Boolean(arg)` when an argument may be missing.
- Mutations: `useMutation` in the feature component or a hook, then
  invalidate the affected keys in `onSuccess` and toast errors with
  `describeError`.
- Defaults (`lib/query/client.ts`): 30 s stale time, retries only for
  retryable `ApiError`s (network, timeout, 429, 5xx), no mutation retries.
- Gate UI for optional backend features with `useFeatureFlags()`.

### Auth and wallet

- `useAuth()` (from `@/hooks/useAuth`) gives `status` (`loading` /
  `signedOut` / `signedIn`), `account`, `signIn()`, `signOut()`, `signingIn`,
  `error` and the `wallet` adapter. Inside `(app)` pages use
  `useCurrentAccount()` from `@/hooks/useAccount` to get the G-address.
- `lib/auth/sep10.ts` does the flow: connect → network check → challenge →
  sanity-check the challenge XDR → sign in the wallet → `/auth/token` →
  store tokens. Signing in again from scratch is always safe.
- Talk to wallets only through `WalletAdapter` (`lib/wallet/types.ts`). To
  sign a transaction built by the backend (the `.../build` routes return
  unsigned XDR):
  ```ts
  const signed = await wallet.signTransaction(xdr, { networkPassphrase: networkPassphrase(), address: account });
  ```
  then submit it through the backend's submit route. Wallet failures are
  `WalletError`s with `code` `NOT_INSTALLED | USER_REJECTED | WRONG_NETWORK | NO_ACCOUNT | UNKNOWN`;
  don't show an error toast for `USER_REJECTED`.
- AuthProvider watches the wallet: switching account signs the user out,
  switching network shows a warning.
- For payment-style flows use `useWalletSubmit()` (`hooks/useWalletSubmit.ts`):
  it signs, optionally wraps the envelope in a fee bump when the user picked
  a higher fee, submits with an idempotency key (create one per confirmed
  submission with `newIdempotencyKey()` and reuse it on retries) and
  invalidates the account's queries. Never edit a built envelope: the backend
  relays only transactions whose (inner) hash it built. Raise a fee by
  wrapping instead (`lib/stellar/feeBump.ts`).
- Every `/wallet/*` route is behind `requireAccountMatch()`, which needs the
  acting account in the body or the query. `api.wallet` sends
  `?sourcePublicKey=` for routes whose body has no actor field (submit,
  paths, payment requests).

### Stellar helpers (`lib/stellar`)

`networkPassphrase()`, `networkFromPassphrase()`, `explorerUrl()` /
`txUrl()` / `accountUrl()`, address validators (`isAccountId`,
`isMuxedAddress`, `isContractId`, `isFederationAddress`), exact amount maths
(`toStroops`, `fromStroops`, `isValidAmount`, `compareAmounts`,
`addAmounts`, `subtractAmounts`) and asset ids (`assetId`, `parseAssetId`,
`assetFromBalanceLine`, `compareAssets`). Asset ids match the backend:
`"XLM"` or `"CODE:ISSUER"`. Use these instead of re-implementing.
Payment helpers: `classifyRecipient` / `recipientError` (G, M, federation,
contract), `validateMemo` (text ≤ 28 UTF-8 bytes, uint64 id, 32-byte hash),
`maxSendable` / `amountError` (reserve- and fee-aware), fee bumps
(`buildFeeBump`, `needsFeeBump`) and path-payment route helpers (`bestPath`,
`pathAssetIds`, `exchangeRate`).

### Testing

- `npm test --workspace frontend` (or `npx vitest` in `frontend/`).
- Component tests: Testing Library queries by role/label, `userEvent` for
  interaction. Wrap components that use React Query or toasts with
  `renderWithProviders` from `@/test/render`. Mock `next/navigation` with
  `vi.mock` when a component uses the router.
- Mock the API at the module boundary (`vi.spyOn(api.account, "reserves")`)
  in component tests, and with `mockFetch` in endpoint tests.
- Code that builds or parses Stellar XDR in tests needs
  `// @vitest-environment node` at the top of the file (stellar-base's
  `Uint8Array` checks fail across the jsdom realm).

### Quality gates

Every commit must pass, from `frontend/`: `npm run lint`, `npm run typecheck`,
`npm test` and `npm run build`. CI runs the same in `.github/workflows/frontend.yml`.
After adding dependencies, refresh the root lockfile with npm 10
(`npx -y npm@10 install` at the repo root).

## Backend coverage

| Route group | Backend file | Frontend module |
|---|---|---|
| `/api/v1/auth`, `/auth/csrf` | `routes/auth.ts`, `app.ts` | `endpoints/auth.ts`, `client.ensureCsrfToken` |
| `/api/v1/account` | `routes/account.ts` | `endpoints/account.ts` (reads, muxed, CSV, claimable balances + claim/reclaim builds, close dry run/build) |
| `/api/v1/config`, `/api/v1/network`, `/api/v1/flags`, `/health`, `/api/v1/health/details` | `routes/config.ts`, `routes/network.ts`, `routes/flags.ts`, `app.ts` | `endpoints/config.ts` |
| `/api/v1/price` | `routes/price.ts` | `endpoints/price.ts` |
| `/api/v1/me/preferences` | `routes/preferences.ts` | `endpoints/preferences.ts` |
| `/api/v1/dev` (testnet) | `routes/dev.ts` | `endpoints/dev.ts` |
| `/api/v1/wallet` (+ client-signing builds and submit) | `routes/wallet.ts`, `routes/clientSigning.ts` | `endpoints/wallet.ts` (send/path-payment/trustline builds, precheck, paths, payment requests, sponsor fee, submit) and `endpoints/multisig.ts`; swaps (`/swap`) are strict-send/receive path payments to self, helpers in `lib/swap/` on top of `lib/stellar/paths.ts` |
| `/api/v1/transactions` | `routes/transactions.ts` | `endpoints/transactions.ts` (detail, status, account statuses; signatures come from Horizon, `lib/stellar/horizon.ts`) |
| `/api/v1/assets` | `routes/assets.ts` | `endpoints/assets.ts` (verified, search, stellar.toml metadata) |
| `/api/v1/resolve` | `routes/resolve.ts` | `endpoints/resolve.ts` |
| `/api/v1/pending-txs` | `routes/pendingTx.ts` | `endpoints/pendingTxs.ts` |
| `/api/v1/contract` | `routes/contract.ts` | `endpoints/contract.ts` |
| `/api/v1/me/devices` | `routes/devices.ts` | `endpoints/devices.ts` |
| `/api/v1/me/email` | `routes/email.ts` | `endpoints/email.ts` |

Not for the web app: `/api/v1/csp-report` (browser CSP reports),
`/api/v1/admin/rotate-jwt-keys` (operators), `/.well-known/jwks.json`, `/metrics`.
