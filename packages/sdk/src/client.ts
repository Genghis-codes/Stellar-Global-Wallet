/**
 * SDK HTTP client with transparent token refresh and retry handling.
 *
 * - Single-flight refresh: parallel 401s share one `/api/v1/auth/refresh` call.
 * - Only `TOKEN_EXPIRED` triggers refresh; other 401s surface as-is.
 * - Pluggable `TokenStore` (in-memory default; web/mobile supply their own).
 * - 429/503 retried with exponential backoff + jitter, honouring `Retry-After`.
 * - Non-idempotent POSTs are only retried when an `Idempotency-Key` is present.
 *
 * Runtime-safe for Node, browsers and React Native (no Node-only modules).
 */

/** The pair returned by sign-in and by `/api/v1/auth/refresh`. */
export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
}

export interface TokenStore {
  get(): Promise<AuthTokens | null> | AuthTokens | null;
  set(tokens: AuthTokens): Promise<void> | void;
  clear(): Promise<void> | void;
}

export class InMemoryTokenStore implements TokenStore {
  private tokens: AuthTokens | null = null;

  get(): AuthTokens | null {
    return this.tokens;
  }

  set(tokens: AuthTokens): void {
    this.tokens = tokens;
  }

  clear(): void {
    this.tokens = null;
  }
}

/** Thrown when the refresh token itself is expired or revoked. */
export class SessionExpiredError extends Error {
  readonly code = 'SESSION_EXPIRED';

  constructor(message = 'Session expired; please sign in again.') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

/** Thrown when a request fails with a non-retryable, non-auth error. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  tokenStore?: TokenStore;
  /** Called when the refresh token is expired/revoked. */
  onSessionExpired?: () => void;
  /** Max retry attempts for 429/503. Default 3. */
  maxRetries?: number;
  /** Base backoff in ms. Default 250. */
  baseDelayMs?: number;
  /** Injectable fetch (defaults to global fetch). */
  fetch?: typeof fetch;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  /** Idempotency key; required to retry non-idempotent POSTs. */
  idempotencyKey?: string;
}

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'AbortError'
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

/**
 * Pull `{ code, message }` out of an error response. The backend wraps
 * errors as `{ error: { code, message, details?, requestId } }`; a bare
 * top-level `code` is still accepted for older deployments.
 */
function readErrorBody(body: unknown): { code?: string; message?: string } {
  if (typeof body !== 'object' || body === null) return {};
  const envelope = (body as { error?: unknown }).error;
  if (typeof envelope === 'object' && envelope !== null) {
    const { code, message } = envelope as { code?: unknown; message?: unknown };
    return {
      code: typeof code === 'string' ? code : undefined,
      message: typeof message === 'string' ? message : undefined,
    };
  }
  const code = (body as { code?: unknown }).code;
  return { code: typeof code === 'string' ? code : undefined };
}

/** A single operation in a built transaction, as returned by the backend. */
export interface BuiltOperation {
  type: string;
  [key: string]: unknown;
}

/** A transaction built by the backend, ready to be signed and submitted. */
export interface BuiltTransaction {
  /** Base64-encoded transaction envelope (XDR). */
  xdr: string;
  /** Network passphrase the transaction is bound to. */
  networkPassphrase: string;
  /** Human-readable summary of the operations in the transaction. */
  operations: BuiltOperation[];
  /** Optional fee/resource estimate produced by simulation. */
  simulation?: {
    success: boolean;
    fee?: string;
    error?: string;
  };
}

/** Request body for `POST /api/v1/account/close`. */
export interface BuildCloseAccountRequest {
  /** Stellar account (G...) to close. */
  account: string;
  /** Destination account (G...) that receives remaining balances and reserves. */
  destination: string;
  /** Optional secret-free signing hints; the backend never signs. */
  memo?: string;
}

/** Request body for `POST /api/v1/claimable-balances/claim`. */
export interface BuildClaimClaimableBalanceRequest {
  /** Stellar account (G...) claiming the balance. */
  account: string;
  /** Claimable balance id (hex, 72 chars). */
  balanceId: string;
  /** Create the asset trustline first when the account lacks it. */
  createTrustline?: boolean;
}

/** Request body for `POST /api/v1/claimable-balances/reclaim`. */
export interface BuildReclaimClaimableBalanceRequest {
  /** Stellar account (G...) reclaiming the balance (must be the sponsor). */
  account: string;
  /** Claimable balance id (hex, 72 chars). */
  balanceId: string;
}

/** Predicate evaluation state for a claimable balance. */
export type ClaimableBalanceState = 'claimable_now' | 'claimable_after' | 'claimable_before' | 'expired';

/** A claimable balance with its predicates evaluated server-side. */
export interface ClaimableBalance {
  id: string;
  asset: string;
  amount: string;
  sponsor: string;
  claimant: string;
  /** ISO-8601 timestamp of the absolute-time predicate, when present. */
  claimableAfter?: string;
  /** ISO-8601 timestamp of the absolute-time upper bound, when present. */
  claimableBefore?: string;
  state: ClaimableBalanceState;
}

/** Response for `GET /api/v1/claimable-balances`. */
export interface ListClaimableBalancesResponse {
  balances: ClaimableBalance[];
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly tokenStore: TokenStore;
  private readonly onSessionExpired?: () => void;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  /** Shared in-flight refresh promise (single-flight). */
  private refreshPromise: Promise<string> | null = null;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.tokenStore = options.tokenStore ?? new InMemoryTokenStore();
    this.onSessionExpired = options.onSessionExpired;
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 250;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Single-flight refresh. All concurrent callers share one promise so
   * rotating refresh tokens are only consumed once.
   */
  private refresh(): Promise<string> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.performRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async performRefresh(): Promise<string> {
    const current = await this.tokenStore.get();
    if (!current?.refreshToken) {
      await this.expireSession();
    }

    const res = await this.fetchImpl(`${this.baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: current?.refreshToken }),
    });

    if (!res.ok) {
      await this.expireSession();
    }

    // Refresh tokens rotate on every use, so store the new pair.
    const data = (await res.json()) as { accessToken?: string; refreshToken?: string };
    if (!data.accessToken) {
      await this.expireSession();
    }
    await this.tokenStore.set({
      accessToken: data.accessToken as string,
      refreshToken: data.refreshToken ?? current?.refreshToken,
    });
    return data.accessToken as string;
  }

  private async expireSession(): Promise<never> {
    await this.tokenStore.clear();
    this.onSessionExpired?.();
    throw new SessionExpiredError();
  }

  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = (options.method ?? 'GET').toUpperCase();
    const idempotent = IDEMPOTENT_METHODS.has(method) || Boolean(options.idempotencyKey);

    let refreshed = false;
    let attempt = 0;

    for (;;) {
      if (options.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const token = (await this.tokenStore.get())?.accessToken;
      const headers: Record<string, string> = {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
        ...options.headers,
      };

      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: options.signal,
        });
      } catch (err) {
        if (isAbortError(err)) throw err;
        throw err;
      }

      if (res.status === 401 && !refreshed) {
        const body = await this.safeJson(res);
        const { code, message } = readErrorBody(body);
        if (code === 'TOKEN_EXPIRED') {
          refreshed = true;
          // Await the shared refresh; if aborted while waiting, propagate.
          await this.refresh();
          if (options.signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          continue;
        }
        throw new ApiError(message ?? 'Unauthorized', res.status, code, body);
      }

      if ((res.status === 429 || res.status === 503) && idempotent && attempt < this.maxRetries) {
        const retryAfter = parseRetryAfter(res.headers.get('Retry-After'));
        const backoff = this.baseDelayMs * 2 ** attempt;
        const jitter = Math.random() * this.baseDelayMs;
        const delay = retryAfter ?? backoff + jitter;
        attempt += 1;
        await sleep(delay, options.signal);
        continue;
      }

      const body = await this.safeJson(res);
      if (!res.ok) {
        const { code, message } = readErrorBody(body);
        throw new ApiError(message ?? `Request failed with status ${res.status}`, res.status, code, body);
      }
      return body as T;
    }
  }

  /** Build a transaction that closes `account` and merges it into `destination`. */
  buildCloseAccount(
    body: BuildCloseAccountRequest,
    options: Omit<RequestOptions, 'method' | 'body'> = {},
  ): Promise<BuiltTransaction> {
    return this.request<BuiltTransaction>('/api/v1/account/close', {
      ...options,
      method: 'POST',
      body,
      idempotencyKey: options.idempotencyKey ?? `close-account:${body.account}`,
    });
  }

  /** List claimable balances for the authenticated account with evaluated predicates. */
  listClaimableBalances(
    options: Omit<RequestOptions, 'method' | 'body'> = {},
  ): Promise<ListClaimableBalancesResponse> {
    return this.request<ListClaimableBalancesResponse>('/api/v1/claimable-balances', {
      ...options,
      method: 'GET',
    });
  }

  /** Build a transaction that claims a claimable balance (creating the trustline if needed). */
  buildClaimClaimableBalance(
    body: BuildClaimClaimableBalanceRequest,
    options: Omit<RequestOptions, 'method' | 'body'> = {},
  ): Promise<BuiltTransaction> {
    return this.request<BuiltTransaction>('/api/v1/claimable-balances/claim', {
      ...options,
      method: 'POST',
      body,
      idempotencyKey: options.idempotencyKey ?? `claim-balance:${body.balanceId}`,
    });
  }

  /** Build a transaction that reclaims a claimable balance (sponsor only). */
  buildReclaimClaimableBalance(
    body: BuildReclaimClaimableBalanceRequest,
    options: Omit<RequestOptions, 'method' | 'body'> = {},
  ): Promise<BuiltTransaction> {
    return this.request<BuiltTransaction>('/api/v1/claimable-balances/reclaim', {
      ...options,
      method: 'POST',
      body,
      idempotencyKey: options.idempotencyKey ?? `reclaim-balance:${body.balanceId}`,
    });
  }

  private async safeJson(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

/** Create an `ApiClient` for the GlobeWallet REST API. */
export function createClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options);
}
