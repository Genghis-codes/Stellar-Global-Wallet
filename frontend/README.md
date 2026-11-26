# GlobeWallet web app

The browser frontend for GlobeWallet: a Next.js (App Router) app in TypeScript
and Tailwind CSS. It is an npm workspace of the repo root, next to `backend/`
and `packages/*`.

Users sign in with [Freighter](https://www.freighter.app/) through SEP-10:
the app fetches a challenge from the backend, Freighter signs it, and the
backend issues an access/refresh token pair. Keys never leave the wallet.

## Requirements

- Node.js 20.19+ (CI uses 22) and npm 10
- The [Freighter](https://www.freighter.app/) browser extension, set to the
  same network as the backend (testnet by default)
- A running backend (see below)

## Run against the local backend

1. Install everything once, from the **repo root** (the lockfile lives there):

   ```bash
   npm install
   ```

2. Start the backend (`backend/README.md` covers Postgres/Redis and Docker).
   For browser sign-in it needs, in `backend/.env`:

   ```bash
   PORT=4000
   STELLAR_NETWORK=testnet
   CORS_ORIGIN=http://localhost:3000        # the frontend origin
   SEP10_SIGNING_SECRET=S...                 # server key that signs SEP-10 challenges
   HOME_DOMAIN=localhost
   WEB_AUTH_DOMAIN=localhost
   ```

   Without `SEP10_SIGNING_SECRET` the challenge route answers 503
   (`SEP10_NOT_CONFIGURED`) and sign-in fails.

   ```bash
   npm run dev --workspace backend
   ```

3. Configure and start the frontend:

   ```bash
   cp frontend/.env.example frontend/.env.local
   npm run dev --workspace frontend
   ```

   Open http://localhost:3000, click **Connect Freighter** and approve the
   connection and the sign-in challenge. On testnet, a new (unfunded) account
   can be funded from the dashboard with Friendbot.

## Environment

All variables are public (`NEXT_PUBLIC_*`) and are inlined at build time.
See [`.env.example`](.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Backend base URL |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet` | `testnet`, `mainnet` or `futurenet`; Freighter must match |
| `NEXT_PUBLIC_HORIZON_URL` | network default | Horizon for read-only helpers |
| `NEXT_PUBLIC_EXPLORER_URL` | `https://stellar.expert/explorer` | Explorer links |
| `NEXT_PUBLIC_API_TIMEOUT_MS` | `15000` | API request timeout |

## Scripts

Run from the repo root with `--workspace frontend`, or from `frontend/`:

| Script | What it does |
|---|---|
| `dev` | Next.js dev server on port 3000 |
| `build` / `start` | Production build / serve it |
| `lint` | ESLint (Next.js core-web-vitals + TypeScript rules) |
| `typecheck` | `tsc --noEmit` (strict) |
| `test` / `test:watch` | Vitest + Testing Library |

CI (`.github/workflows/frontend.yml`) runs `npm ci` at the root, then lint,
typecheck, test and build for this workspace.

## Contributing

Folder layout, naming and how to add pages, API modules and hooks are in
[ARCHITECTURE.md](ARCHITECTURE.md).
