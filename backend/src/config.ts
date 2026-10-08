import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  HORIZON_URL: z.string().url().default("https://horizon-testnet.stellar.org"),
  NETWORK_PASSPHRASE: z.string().min(1),
  CORS_ORIGIN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  API_KEY: z.string().min(1),
  // "in-process" serializes concurrent submissions for the same source
  // account within a single Node process only. Running more than one
  // instance of this API requires "redis" (using REDIS_URL below) to get
  // the same guarantee across instances — see docs/concurrency.md.
  LOCK_BACKEND: z.enum(["in-process", "redis"]).default("in-process"),

  // Soroban RPC is a distinct protocol/endpoint from Horizon (simulate/send/
  // getTransaction vs. classic submitTransaction) and testnet/mainnet often
  // run it on a different host, so it gets its own client config rather than
  // reusing HORIZON_URL/NETWORK_PASSPHRASE.
  SOROBAN_RPC_URL: z.string().url().default("https://soroban-testnet.stellar.org"),
  SOROBAN_NETWORK_PASSPHRASE: z.string().min(1).default("Test SDF Network ; September 2015"),
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
});

export const config = envSchema.parse(process.env);
