/**
 * Where the API client keeps the session tokens issued by
 * POST /api/v1/auth/token (SEP-10) and rotated by POST /api/v1/auth/refresh.
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** The G... account the session belongs to (the JWT `sub`). */
  account?: string;
}

export interface TokenStore {
  get(): AuthTokens | null;
  set(tokens: AuthTokens): void;
  clear(): void;
  /** Notified after every set/clear; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

abstract class ObservableStore implements TokenStore {
  private listeners = new Set<() => void>();
  abstract get(): AuthTokens | null;
  protected abstract write(tokens: AuthTokens | null): void;

  set(tokens: AuthTokens): void {
    this.write(tokens);
    this.emit();
  }

  clear(): void {
    this.write(null);
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }
}

export class MemoryTokenStore extends ObservableStore {
  private tokens: AuthTokens | null = null;

  get(): AuthTokens | null {
    return this.tokens;
  }

  protected write(tokens: AuthTokens | null): void {
    this.tokens = tokens;
  }
}

function isAuthTokens(value: unknown): value is AuthTokens {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AuthTokens).accessToken === "string" &&
    typeof (value as AuthTokens).refreshToken === "string"
  );
}

/**
 * Persists the session in Web Storage. The app uses sessionStorage, so the
 * session ends with the tab and never outlives the browser session; the
 * value is cached in memory to avoid re-parsing on every request.
 */
export class WebStorageTokenStore extends ObservableStore {
  private cache: AuthTokens | null | undefined;

  constructor(
    private readonly storage: () => Storage | undefined,
    private readonly key = "gw.session",
  ) {
    super();
  }

  get(): AuthTokens | null {
    if (this.cache !== undefined) return this.cache;
    let parsed: unknown = null;
    try {
      const raw = this.storage()?.getItem(this.key);
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    this.cache = isAuthTokens(parsed) ? parsed : null;
    return this.cache;
  }

  protected write(tokens: AuthTokens | null): void {
    this.cache = tokens;
    try {
      if (tokens) this.storage()?.setItem(this.key, JSON.stringify(tokens));
      else this.storage()?.removeItem(this.key);
    } catch {
      // Storage full or disabled (private mode): keep the in-memory copy.
    }
  }
}
