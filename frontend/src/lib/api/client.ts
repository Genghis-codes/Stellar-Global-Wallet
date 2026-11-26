import { CSRF_PATH, csrfHeaders, getCsrfToken, isUnsafeMethod, setCsrfToken } from "./csrf";
import { ApiError, toApiError } from "./errors";
import { MemoryTokenStore, type AuthTokens, type TokenStore } from "./tokens";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: HttpMethod;
  /** Query string parameters; null/undefined values are dropped. */
  query?: Record<string, QueryValue>;
  /** JSON-serialised request body. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Attach the bearer access token (and refresh it on TOKEN_EXPIRED). Default true. */
  auth?: boolean;
  signal?: AbortSignal;
  /** Per-request timeout override, in ms. */
  timeoutMs?: number;
  /** Return the raw text body instead of parsing JSON (CSV export). */
  responseType?: "json" | "text";
}

export interface ApiClientConfig {
  baseUrl: string;
  timeoutMs?: number;
  tokens?: TokenStore;
  fetch?: typeof fetch;
  /** Called when the refresh token is rejected and the session is gone. */
  onSessionExpired?: () => void;
  /** Path of the backend's refresh route. */
  refreshPath?: string;
}

export interface ApiClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  get<T>(path: string, options?: Omit<RequestOptions, "method" | "body">): Promise<T>;
  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">): Promise<T>;
  put<T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">): Promise<T>;
  delete<T>(path: string, options?: Omit<RequestOptions, "method" | "body">): Promise<T>;
  /** Make sure a CSRF token is known, fetching one from GET /auth/csrf if not. */
  ensureCsrfToken(): Promise<string>;
  readonly tokens: TokenStore;
  readonly baseUrl: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_REFRESH_PATH = "/api/v1/auth/refresh";
/** 401 codes that mean the session itself is unusable (sign in again). */
const SESSION_ENDING_CODES = new Set(["SESSION_REVOKED", "AUTH_TOKEN_INVALID", "AUTH_TOKEN_TYPE_INVALID"]);

export function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(path.replace(/^\/?/, "/"), baseUrl.replace(/\/+$/, "") + "/");
  // URL() with an absolute path drops any base path; keep it.
  const basePath = new URL(baseUrl).pathname.replace(/\/+$/, "");
  if (basePath && !url.pathname.startsWith(basePath + "/")) url.pathname = basePath + url.pathname;
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function readBody(response: Response, type: "json" | "text"): Promise<unknown> {
  const text = await response.text();
  if (type === "text") return text;
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const baseUrl = config.baseUrl;
  const tokens = config.tokens ?? new MemoryTokenStore();
  const defaultTimeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const refreshPath = config.refreshPath ?? DEFAULT_REFRESH_PATH;
  const doFetch: typeof fetch = (...args) => (config.fetch ?? globalThis.fetch)(...args);

  async function send(path: string, options: RequestOptions, accessToken?: string): Promise<Response> {
    const method = options.method ?? "GET";
    const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (isUnsafeMethod(method)) Object.assign(headers, csrfHeaders());

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? defaultTimeout;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) controller.abort();

    try {
      return await doFetch(buildUrl(baseUrl, path, options.query), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: "include",
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new ApiError(`Request timed out after ${timeoutMs}ms`, { status: 0, code: "TIMEOUT", retryable: true });
      }
      if (controller.signal.aborted) {
        throw new ApiError("Request was cancelled", { status: 0, code: "ABORTED", retryable: false });
      }
      throw new ApiError(error instanceof Error ? error.message : "Network request failed", {
        status: 0,
        code: "NETWORK_ERROR",
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  let refreshing: Promise<AuthTokens | null> | null = null;

  /**
   * Single-flight refresh: concurrent TOKEN_EXPIRED responses share one call
   * to the refresh route. The backend rotates the refresh token on every use,
   * so two parallel refreshes would revoke each other.
   */
  function refresh(): Promise<AuthTokens | null> {
    if (!refreshing) {
      refreshing = (async () => {
        const current = tokens.get();
        if (!current?.refreshToken) return null;
        try {
          const response = await send(refreshPath, {
            method: "POST",
            body: { refreshToken: current.refreshToken },
          });
          if (!response.ok) return null;
          const body = (await readBody(response, "json")) as Partial<AuthTokens> | undefined;
          if (!body?.accessToken || !body.refreshToken) return null;
          const next: AuthTokens = { ...current, accessToken: body.accessToken, refreshToken: body.refreshToken };
          tokens.set(next);
          return next;
        } catch {
          return null;
        }
      })().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  function expireSession(): never {
    if (tokens.get()) {
      tokens.clear();
      config.onSessionExpired?.();
    }
    throw new ApiError("Your session has expired. Please sign in again.", {
      status: 401,
      code: "SESSION_EXPIRED",
      retryable: false,
    });
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const useAuth = options.auth !== false;
    const responseType = options.responseType ?? "json";
    const accessToken = useAuth ? tokens.get()?.accessToken : undefined;

    let response = await send(path, options, accessToken);
    let body = await readBody(response, response.ok ? responseType : "json");

    if (response.status === 401 && accessToken) {
      const error = toApiError(401, body, response.headers.get("x-request-id"));
      // The backend asks clients to refresh only on TOKEN_EXPIRED; a revoked
      // session or an invalid token means signing in again.
      if (SESSION_ENDING_CODES.has(error.code)) expireSession();
      if (error.code !== "TOKEN_EXPIRED") throw error;
      const renewed = await refresh();
      if (!renewed) expireSession();
      response = await send(path, options, renewed.accessToken);
      body = await readBody(response, response.ok ? responseType : "json");
      if (response.status === 401) expireSession();
    }

    if (!response.ok) {
      throw toApiError(response.status, body, response.headers.get("x-request-id"));
    }
    return body as T;
  }

  async function ensureCsrfToken(): Promise<string> {
    const known = getCsrfToken();
    if (known) return known;
    const { csrfToken } = await request<{ csrfToken: string }>(CSRF_PATH, { auth: false });
    setCsrfToken(csrfToken);
    return csrfToken;
  }

  return {
    request,
    ensureCsrfToken,
    get: (path, options) => request(path, { ...options, method: "GET" }),
    post: (path, body, options) => request(path, { ...options, method: "POST", body }),
    put: (path, body, options) => request(path, { ...options, method: "PUT", body }),
    delete: (path, options) => request(path, { ...options, method: "DELETE" }),
    tokens,
    baseUrl,
  };
}
