import { z } from "zod";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// #283 — Secrets management and rotation.
//
// Secrets (JWT keys, sponsor keys, SMTP credentials) used to be plain env
// vars baked into the Render service definition, so rotating any of them
// required a redeploy and a leak exposed everything at once. This module
// introduces a small provider abstraction so the same config surface can be
// sourced from env vars (default, dev/test), HashiCorp Vault, or AWS Secrets
// Manager, and exposes a hot-reload hook so rotated values are picked up
// without a redeploy.
//
// Threat model: the provider is the only component that talks to the secret
// store; the rest of the app reads through `getSecret`/`reloadSecrets`.
// Failure modes: if the provider is unreachable at boot we fail fast (same as
// a missing env var today); if a hot reload fails we keep the last known-good
// values and log, so a transient Vault/AWS outage never takes the API down.

export type SecretProviderKind = "env" | "vault" | "aws-sm";

// Names of the secrets that are rotatable at runtime. Anything not listed here
// is treated as static config and only read once at boot.
export const ROTATABLE_SECRET_NAMES = [
  "JWT_SECRET",
  "API_KEY",
  "SPONSOR_SECRET_KEY",
  "RESEND_API_KEY",
  "AWS_SES_SECRET_ACCESS_KEY",
] as const;

export type RotatableSecretName = (typeof ROTATABLE_SECRET_NAMES)[number];

export interface SecretProvider {
  readonly kind: SecretProviderKind;
  /** Fetch the current value for a secret, or undefined if unset. */
  get(name: string): Promise<string | undefined>;
  /** Fetch all rotatable secrets in one round-trip. */
  getAll(names: readonly string[]): Promise<Record<string, string | undefined>>;
}

// Env provider: reads from process.env. This is the default and preserves the
// existing behaviour for local dev, tests, and any deployment that has not
// opted into a managed store yet.
class EnvSecretProvider implements SecretProvider {
  readonly kind = "env" as const;
  async get(name: string): Promise<string | undefined> {
    return process.env[name];
  }
  async getAll(names: readonly string[]): Promise<Record<string, string | undefined>> {
    const out: Record<string, string | undefined> = {};
    for (const name of names) out[name] = process.env[name];
    return out;
  }
}

// Vault provider: reads KV v2 secrets from a HashiCorp Vault instance. Uses the
// HTTP API directly (no SDK dependency) so this stays a zero-install change.
// VAULT_ADDR + VAULT_TOKEN are themselves bootstrapped from env — they are the
// root of trust and are expected to be short-lived (Vault AppRole / OIDC).
class VaultSecretProvider implements SecretProvider {
  readonly kind = "vault" as const;
  constructor(
    private readonly addr: string,
    private readonly token: string,
    private readonly mount: string,
    private readonly path: string
  ) {}

  private async readAll(): Promise<Record<string, string | undefined>> {
    const url = `${this.addr.replace(/\/$/, "")}/v1/${this.mount}/data/${this.path}`;
    const res = await fetch(url, {
      headers: { "X-Vault-Token": this.token },
    });
    if (!res.ok) {
      throw new Error(`Vault read failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as { data?: { data?: Record<string, unknown> } };
    const data = body.data?.data ?? {};
    const out: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(data)) {
      out[k] = typeof v === "string" ? v : v === undefined ? undefined : String(v);
    }
    return out;
  }

  async get(name: string): Promise<string | undefined> {
    return (await this.readAll())[name];
  }
  async getAll(names: readonly string[]): Promise<Record<string, string | undefined>> {
    const all = await this.readAll();
    const out: Record<string, string | undefined> = {};
    for (const name of names) out[name] = all[name];
    return out;
  }
}

// AWS Secrets Manager provider: reads a single JSON secret blob whose keys are
// the secret names. Uses the AWS SDK v3 client that is already a transitive
// dependency of the SES email provider, so no new install is required.
class AwsSecretsManagerProvider implements SecretProvider {
  readonly kind = "aws-sm" as const;
  constructor(
    private readonly region: string,
    private readonly secretId: string
  ) {}

  private async readAll(): Promise<Record<string, string | undefined>> {
    // Lazy import so deployments that use env/Vault never load the AWS SDK.
    const { SecretsManagerClient, GetSecretValueCommand } = await import(
      "@aws-sdk/client-secrets-manager"
    );
    const client = new SecretsManagerClient({ region: this.region });
    const res = await client.send(new GetSecretValueCommand({ SecretId: this.secretId }));
    const raw = res.SecretString;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k] = typeof v === "string" ? v : v === undefined ? undefined : String(v);
    }
    return out;
  }

  async get(name: string): Promise<string | undefined> {
    return (await this.readAll())[name];
  }
  async getAll(names: readonly string[]): Promise<Record<string, string | undefined>> {
    const all = await this.readAll();
    const out: Record<string, string | undefined> = {};
    for (const name of names) out[name] = all[name];
    return out;
  }
}

// Build the provider from env. Kept separate from the zod schema below so the
// provider can be constructed before the full config is validated (the
// provider itself supplies some of the values the schema validates).
export function createSecretProvider(env: NodeJS.ProcessEnv = process.env): SecretProvider {
  const kind = (env.SECRET_PROVIDER ?? "env") as SecretProviderKind;
  switch (kind) {
    case "vault": {
      const addr = env.VAULT_ADDR;
      const token = env.VAULT_TOKEN;
      if (!addr || !token) {
        throw new Error("SECRET_PROVIDER=vault requires VAULT_ADDR and VAULT_TOKEN");
      }
      return new VaultSecretProvider(
        addr,
        token,
        env.VAULT_SECRET_MOUNT ?? "secret",
        env.VAULT_SECRET_PATH ?? "globewallet"
      );
    }
    case "aws-sm": {
      const region = env.AWS_REGION ?? env.AWS_SES_REGION;
      const secretId = env.AWS_SECRETS_MANAGER_SECRET_ID;
      if (!region || !secretId) {
        throw new Error(
          "SECRET_PROVIDER=aws-sm requires AWS_REGION (or AWS_SES_REGION) and AWS_SECRETS_MANAGER_SECRET_ID"
        );
      }
      return new AwsSecretsManagerProvider(region, secretId);
    }
    case "env":
      return new EnvSecretProvider();
    default:
      throw new Error(`Unknown SECRET_PROVIDER "${kind}" (expected env, vault, or aws-sm)`);
  }
}

// In-memory cache of the last known-good rotatable secret values. Reads go
// through here so hot reload is a single atomic swap and a failed reload never
// leaves the app with a half-updated set of secrets.
let secretCache: Record<string, string | undefined> = {};
let secretProvider: SecretProvider = new EnvSecretProvider();

/**
 * Load (or reload) all rotatable secrets from the configured provider.
 *
 * On success the cache is swapped atomically. On failure the previous values
 * are retained and the error is rethrown so callers (boot path or the
 * rotation webhook) can decide whether to fail fast or just log.
 */
export async function reloadSecrets(
  provider: SecretProvider = secretProvider
): Promise<Record<string, string | undefined>> {
  const fresh = await provider.getAll(ROTATABLE_SECRET_NAMES);
  secretCache = { ...fresh };
  secretProvider = provider;
  return secretCache;
}

/** Read a rotatable secret from the cache, falling back to env. */
export function getSecret(name: RotatableSecretName): string | undefined {
  return secretCache[name] ?? process.env[name];
}

/** Exposed for tests and the rotation webhook to inspect the active provider. */
export function getSecretProviderKind(): SecretProviderKind {
  return secretProvider.kind;
}

// #41 — CORS origins are validated at startup so a typo (trailing space,
// missing scheme) fails fast with a clear message instead of silently
// blocking the web app at request time. Each comma-separated entry is
// trimmed and must parse as a URL. `exp://` origins (Expo dev) are kept
// supported — `new URL()` accepts them.
const corsOriginSchema = z
  .string()
  .min(1)
  .transform((raw, ctx) => {
    const origins = raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (origins.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CORS_ORIGIN must contain at least one origin",
      });
      return z.NEVER;
    }

    for (const origin of origins) {
      try {
        // eslint-disable-next-line no-new
        new URL(origin);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `CORS_ORIGIN entry "${origin}" is not a valid URL (expected e.g. https://app.globewallet.app or exp://192.168.1.10:8081)`,
        });
        return z.NEVER;
      }
    }

    return origins;
  });

// #41 — opt-in regex for preview deploys (Vercel/Netlify). Validated as a
// compilable RegExp so a bad pattern fails startup rather than throwing on
// the first request.
const corsOriginRegexSchema = z
  .string()
  .min(1)
  .optional()
  .transform((raw, ctx) => {
    if (raw === undefined) return undefined;
    try {
      return new RegExp(raw);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `CORS_ORIGIN_REGEX is not a valid regular expression: ${raw}`,
      });
      return z.NEVER;
    }
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Graceful shutdown timeout in milliseconds (#220).
  // Time allotted to finish in-flight requests, drain submissions, and release locks.
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(25000),
  PORT: z.coerce.number().int().positive().default(4000),
  HORIZON_URL: z.string().url().default("https://horizon-testnet.stellar.org"),
  NETWORK_PASSPHRASE: z.string().min(1),
  CORS_ORIGIN: corsOriginSchema,
  CORS_ORIGIN_REGEX: corsOriginRegexSchema,
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  API_KEY: z.string().min(1),
  // #283 — which secret store backs the rotatable secrets above. "env" keeps
  // the historical behaviour; "vault" and "aws-sm" read from a managed store
  // so rotation no longer requires a redeploy. See docs/secrets-rotation.md.
  SECRET_PROVIDER: z.enum(["env", "vault", "aws-sm"]).default("env"),
  // Vault (KV v2) settings, required when SECRET_PROVIDER=vault.
  VAULT_ADDR: z.string().url().optional(),
  VAULT_TOKEN: z.string().optional(),
  VAULT_SECRET_MOUNT: z.string().default("secret"),
  VAULT_SECRET_PATH: z.string().default("globewallet"),
  // AWS Secrets Manager settings, required when SECRET_PROVIDER=aws-sm.
  AWS_SECRETS_MANAGER_SECRET_ID: z.string().optional(),
  // #283 — sponsor keys live in KMS and are signed remotely; the API never
  // holds the raw secret key. SPONSOR_KMS_KEY_ID is the KMS key alias/ARN.
  SPONSOR_KMS_KEY_ID: z.string().optional(),
  SPONSOR_KMS_REGION: z.string().optional(),
  // "in-process" serializes concurrent submissions for the same source
  // account within a single Node process only. Running more than one
  // instance of this API requires "redis" (using REDIS_URL below) to get
  // the same guarantee across instances — see docs/concurrency.md.
  LOCK_BACKEND: z.enum(["in-process", "redis"]).default("in-process"),

  // #292 — channel account pool for high-throughput sponsored submissions.
  //
  // Sponsored (fee-bumped) submissions used to serialise on a single source
  // account, capping throughput at one transaction per ledger. The pool gives
  // each in-flight submission its own leased channel account so up to
  // CHANNEL_POOL_SIZE transactions can land per ledger.
  //
  // Threat model: channel secret keys are the only signing authority the pool
  // holds; they can only spend their own account's XLM (fees are paid by the
  // treasury via fee-bump), so a leak is bounded to the channel balances.
  // Prefer CHANNEL_ACCOUNTS_KMS_KEY_ID so raw seeds never live in env.
  //
  // Failure modes: when the pool is disabled or exhausted, submissions fall
  // back to the legacy single-source path (serialised, still correct).
  CHANNEL_POOL_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Number of channel accounts in the pool. Each leased channel allows one
  // in-flight transaction, so this is the effective per-ledger throughput.
  CHANNEL_POOL_SIZE: z.coerce.number().int().positive().max(100).default(4),
  // Comma-separated Stellar secret seeds (S...) for the channel accounts.
  // Must contain at least CHANNEL_POOL_SIZE entries when the pool is enabled
  // and no KMS reference is configured. Parsed into an array below.
  CHANNEL_ACCOUNT_SECRETS: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw.trim() === "") return [] as string[];
      const seeds = raw
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      for (const seed of seeds) {
        if (!/^S[A-Z2-7]{55}$/.test(seed)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `CHANNEL_ACCOUNT_SECRETS entry is not a Stellar secret seed (S...): ${seed.slice(0, 4)}...`,
          });
          return z.NEVER;
        }
      }
      return seeds;
    }),
  // Alternative to CHANNEL_ACCOUNT_SECRETS: a KMS key alias/ARN whose secret
  // payload is a JSON array of channel seeds. Takes precedence when set.
  CHANNEL_ACCOUNTS_KMS_KEY_ID: z.string().optional(),
  // Region for CHANNEL_ACCOUNTS_KMS_KEY_ID; falls back to SPONSOR_KMS_REGION.
  CHANNEL_ACCOUNTS_KMS_REGION: z.string().optional(),
  // A channel account below this XLM balance is topped up before use.
  CHANNEL_MIN_XLM_BALANCE: z.coerce.number().positive().default(2),
  // Amount of XLM sent from the treasury to top a channel back up.
  CHANNEL_TOPUP_XLM: z.coerce.number().positive().default(10),
  // How long a channel lease is held before it is considered abandoned and
  // reclaimed (covers a stuck submission). Must exceed a ledger close.
  CHANNEL_LEASE_TTL_MS: z.coerce.number().int().positive().default(30_000),
  // Treasury account that fee-bumps channel transactions and funds top-ups.
  // Either a raw secret seed (dev/test only) or a KMS reference.
  TREASURY_SECRET: z
    .string()
    .regex(/^S[A-Z2-7]{55}$/, "must be a Stellar secret seed (S...)")
    .optional(),
  TREASURY_KMS_KEY_ID: z.string().optional(),
  // Region for TREASURY_KMS_KEY_ID; falls back to SPONSOR_KMS_REGION.
  TREASURY_KMS_REGION: z.string().optional(),
  // How often the pool monitor checks channel balances, in milliseconds.
  CHANNEL_MONITOR_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),

  // Soroban RPC is a distinct protocol/endpoint from Horizon (simulate/send/
  // getTransaction vs. classic submitTransaction) and testnet/mainnet often
  // run it on a different host, so it gets its own client config rather than
  // reusing HORIZON_URL/NETWORK_PASSPHRASE.
  SOROBAN_RPC_URL: z.string().url().default("https://soroban-testnet.stellar.org"),
  SOROBAN_NETWORK_PASSPHRASE: z.string().min(1).default("Test SDF Network ; September 2015"),
  // #294 — upper bound (in bytes) on individual Horizon REST and Soroban RPC
  // responses accepted before failing closed with a 502 typed error.
  HORIZON_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024)
    .default(2 * 1024 * 1024),
  SOROBAN_RPC_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024)
    .default(2 * 1024 * 1024),
  // Deployed globe-wallet contract ID (C...). Optional so the API can still
  // boot without it; /api/v1/contract/wallet/* routes respond 503 until set.
  // When present, must be a valid Soroban contract StrKey: the letter C
  // followed by exactly 55 uppercase alphanumeric characters (56 chars total),
  // mirroring the isGAddress shape-checks used for G.../S... keys elsewhere.
  GLOBE_WALLET_CONTRACT_ID: z
    .string()
    .regex(
      /^C[A-Z0-9]{55}$/,
      "must be a valid Soroban contract StrKey (C followed by 55 uppercase alphanumeric characters)"
    )
    .optional(),
  TOKEN_WRAPPER_CONTRACT_ID: z
    .string()
    .regex(
      /^C[A-Z0-9]{55}$/,
      "must be a valid Soroban contract StrKey (C followed by 55 uppercase alphanumeric characters)"
    )
    .optional(),
  MIN_CLIENT_VERSION: z.string().min(1).default("0.1.0"),

  // Number of trusted reverse-proxy hops in front of this service, passed
  // straight to Express's `trust proxy` setting (see src/app.ts). This
  // determines which X-Forwarded-For entry Express treats as the real
  // client IP, which is what express-rate-limit keys its per-IP buckets on.
  //
  // Must match the ACTUAL deployment topology — docs/concurrency.md already
  // documents this service running as "multiple processes, containers, or
  // pods behind a load balancer" (the reason RedisAccountLock exists), so a
  // value of 0 (no trust proxy set) is almost certainly wrong in production
  // and silently pools every real client's rate limit into one shared
  // bucket keyed on the proxy's own address.
  //
  // Do NOT set this to a boolean-equivalent "trust everything" value — a
  // hop count higher than the real topology lets a client spoof
  // X-Forwarded-For and bypass rate limiting for their real IP.
  // Changing this number is a deliberate, reviewed infra change, not a
  // quick fix — see issue #90.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),

  // Comma-separated `name:true|false` pairs overriding the defaults in
  // src/services/featureFlags.ts, e.g. `FEATURE_FLAGS=recovery:true`.
  // Lets ops flip a flag per-environment without a deploy; see
  // GET /api/v1/flags (issue: "Add a feature-flag endpoint so clients can
  // toggle unfinished features").
  FEATURE_FLAGS: z.string().optional(),

  // #90 — email notification fallback channel.
  // Provider: "console" (default, dev-safe), "resend", or "ses".
  EMAIL_PROVIDER: z.enum(["console", "resend", "ses"]).default("console"),
  // Sender address used by all transactional emails.
  EMAIL_FROM: z.string().email().default("noreply@globewallet.app"),
  // Resend API key (required when EMAIL_PROVIDER=resend).
  RESEND_API_KEY: z.string().optional(),
  // AWS SES variables (required when EMAIL_PROVIDER=ses).
  AWS_SES_REGION: z.string().optional(),
  AWS_SES_ACCESS_KEY_ID: z.string().optional(),
  AWS_SES_SECRET_ACCESS_KEY: z.string().optional(),
  // Public base URL used to build email verification links.
  BASE_URL: z.string().url().default("https://app.globewallet.app"),

  // Suspicious-payment heuristics for the activity feed (#105). See
  // src/services/paymentFlags.ts for how these are applied.
  SPAM_DUST_THRESHOLD: z.coerce.number().positive().default(0.5),
  // Comma-separated "CODE:ISSUER" pairs. Empty by default — deny-by-default
  // until a curated list exists (#54): every issued (non-native) asset is
  // flagged "unknown_asset" until explicitly added here.
  VERIFIED_ASSETS: z.string().default(""),

  // Which network this deployment talks to. Selects the curated verified-
  // asset list (backend/data/verified-assets.<network>.json, #54), the
  // default USDC issuer used as the USD quote asset for prices (#55), and
  // whether testnet-only routes (Friendbot, #69) are mounted.
  STELLAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),

  // #55 — price oracle. Comma-separated provider order; the first provider
  // that returns a price for an asset wins, later ones are fallbacks.
  PRICE_PROVIDERS: z.string().default("stellar_dex,coingecko"),
  // TTL for spot prices (single and batch lookups share one cache).
  PRICE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(30),
  // Issuer of the USDC asset used as the USD quote on the Stellar DEX.
  // Defaults to Circle's issuer for STELLAR_NETWORK (see services/price/usdQuote.ts).
  PRICE_USDC_ISSUER: z.string().optional(),
  COINGECKO_BASE_URL: z.string().url().default("https://api.coingecko.com/api/v3"),
  // Optional CoinGecko demo/pro API key, sent as x-cg-demo-api-key.
  COINGECKO_API_KEY: z.string().optional(),

  // #77 — contract event indexer settings. The indexer worker itself is not
  // implemented yet (the #141 PR only added config and schema); these are
  // reserved so its deployment config can be prepared ahead of it.
  //
  // Ledger to start indexing from when no cursor exists yet (e.g. the
  // contract's deploy ledger).
  INDEXER_START_LEDGER: z.coerce.number().int().min(0).default(0),
  // How often the worker polls getEvents, in milliseconds.
  INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  // Max events requested per getEvents page (RPC caps this at 10000).
  INDEXER_PAGE_SIZE: z.coerce.number().int().positive().max(10000).default(200),
  // RPC only retains recent events (~7 days on testnet). If the stored
  // cursor falls further behind the latest ledger than this many ledgers,
  // the worker logs an alert because the retention gap means events were
  // permanently lost and a backfill from an archive source is required.
  INDEXER_RETENTION_GAP_LEDGERS: z.coerce.number().int().positive().default(120960),

  // SEP-10 web authentication (GET /api/v1/auth/challenge, POST /token).
  // SEP10_SIGNING_SECRET is the server's S... key that signs challenges;
  // the SEP-10 routes answer 503 until it is set. HOME_DOMAIN and
  // WEB_AUTH_DOMAIN must match what the wallet's stellar.toml advertises.
  SEP10_SIGNING_SECRET: z
    .string()
    .regex(/^S[A-Z2-7]{55}$/, "must be a Stellar secret seed (S...)")
    .optional(),
  HOME_DOMAIN: z.string().min(1).default("globewallet.app"),
  WEB_AUTH_DOMAIN: z.string().min(1).default("globewallet.app"),

  // Fiat conversion for transaction history (see services/fx.ts and
  // docs/transaction-history.md). Rates move slowly, so cache for an hour.
  FX_API_URL: z.string().url().default("https://open.er-api.com/v6/latest/USD"),
  FX_CACHE_TTL_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  // Comma-separated list of currencies to snapshot for historical conversions.
  // Used for tax reporting and historical value tracking. Only supported
  // currencies are stored (see SUPPORTED_CURRENCIES in fx.ts).
  FX_SNAPSHOT_CURRENCIES: z.string().default("EUR,GBP,NGN,KES,GHS"),
  // Upper bound on operations examined per filtered history page (#58).
  HISTORY_SCAN_CAP: z.coerce.number().int().positive().max(10000).default(1000),

  // #185 — TTL keeper job. Disabled unless a funded fee-payer secret is set;
  // the key only pays fees for the permissionless `extend_user_ttl` /
  // RestoreFootprint transactions and never needs any wallet's authority.
  TTL_KEEPER_SECRET_KEY: z
    .string()
    .regex(/^S[A-Z2-7]{55}$/, "must be a Stellar secret seed (S...)")
    .optional(),
  // How often the keeper sweeps active wallets (default: every 6 hours,
  // well inside the contract's 1-day KEEPER_INTERVAL_LEDGERS).
  TTL_KEEPER_INTERVAL_MS: z.coerce.number().int().positive().default(6 * 60 * 60 * 1000),
  // Alert when an entry has fewer than this many ledgers left (~3 days).
  TTL_KEEPER_ALERT_LEDGERS: z.coerce.number().int().positive().default(17_280 * 3),
  // A wallet is "active" if one of its devices was seen within this many days.
  TTL_KEEPER_ACTIVE_DAYS: z.coerce.number().int().positive().default(90),

  // #185/#186 — optional ops webhook (Slack/Discord/PagerDuty-compatible JSON
  // POST) for near-expiry and upgrade-proposed alerts. Alerts are always
  // logged; the webhook is an extra channel.
  OPS_ALERT_WEBHOOK_URL: z.string().url().optional(),

  // #186 — upgrade watcher poll interval.
  UPGRADE_WATCHER_POLL_MS: z.coerce.number().int().positive().default(30_000),

  // #16 — interactive API docs (Swagger UI at /api/docs, raw spec at
  // /api/openapi.json). Defaults to enabled outside production and disabled
  // in production so a prod build never exposes docs unless explicitly
  // opted in via ENABLE_API_DOCS=true.
  ENABLE_API_DOCS: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? process.env.NODE_ENV !== "production" : v === "true")),

  // #124 — Expo push token TTL. Tokens are pruned after this many seconds
  // (default: 90 days). Expo tokens are time-limited; clients must re-register
  // before expiry or they will stop receiving notifications.
  EXPO_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(90 * 24 * 60 * 60),

  // #278 — salt for the device-token fingerprints the risk engine compares.
  RISK_FINGERPRINT_SALT: z.string().optional(),

  // #260 — optional SEP-30 recovery server; unset disables the integration.
  SEP30_SERVER_URL: z.string().url().optional(),
});

export const config = envSchema.parse(process.env);

// #292 — cross-field validation for the channel pool. Kept outside the zod
// object so the error message can name the exact missing setting.
if (config.CHANNEL_POOL_ENABLED) {
  const hasSecrets = config.CHANNEL_ACCOUNT_SECRETS.length > 0;
  const hasKms = Boolean(config.CHANNEL_ACCOUNTS_KMS_KEY_ID);
  if (!hasSecrets && !hasKms) {
    throw new Error(
      "CHANNEL_POOL_ENABLED=true requires CHANNEL_ACCOUNT_SECRETS or CHANNEL_ACCOUNTS_KMS_KEY_ID"
    );
  }
  if (hasSecrets && config.CHANNEL_ACCOUNT_SECRETS.length < config.CHANNEL_POOL_SIZE) {
    throw new Error(
      `CHANNEL_ACCOUNT_SECRETS has ${config.CHANNEL_ACCOUNT_SECRETS.length} entries but CHANNEL_POOL_SIZE is ${config.CHANNEL_POOL_SIZE}`
    );
  }
  if (!config.TREASURY_SECRET && !config.TREASURY_KMS_KEY_ID) {
    throw new Error(
      "CHANNEL_POOL_ENABLED=true requires TREASURY_SECRET or TREASURY_KMS_KEY_ID for fee-bumps and top-ups"
    );
  }
}

// Read the package version once at boot. Resolved relative to this file so it
// works both under ts-node (src/) and compiled output (dist/).
function readPackageVersion(): string {
  try {
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "1.0.0";
  } catch {
    return "1.0.0";
  }
}

const packageVersion = readPackageVersion();
const [, packageMinor = "0"] = packageVersion.split(".");

// API major version is fixed by the URL prefix; minor tracks package.json.
export const API_MAJOR_VERSION = 1;
export const API_VERSION = `${API_MAJOR_VERSION}.${packageMinor}`;
