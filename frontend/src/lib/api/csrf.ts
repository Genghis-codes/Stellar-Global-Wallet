/**
 * Double-submit CSRF support (backend/src/app.ts, issue #35).
 *
 * For cookie-authenticated, state-changing requests the backend requires the
 * `X-CSRF-Token` header to equal the non-httpOnly `gw_csrf` cookie, issued by
 * `GET /auth/csrf` (unversioned, outside /api/v1). Bearer-only requests are
 * exempt, but sending the header is harmless, so the client always attaches
 * it on unsafe methods when a token is known.
 *
 * When the API runs on another origin the cookie is not readable through
 * document.cookie, so the token returned in the /auth/csrf body is also kept
 * in memory.
 */

export const CSRF_COOKIE = "gw_csrf";
export const CSRF_HEADER = "X-CSRF-Token";
export const CSRF_PATH = "/auth/csrf";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

let memoryToken: string | null = null;

export function isUnsafeMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export function readCookie(name: string, cookieString?: string): string | null {
  const source = cookieString ?? (typeof document === "undefined" ? "" : document.cookie);
  for (const part of source.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function setCsrfToken(token: string | null): void {
  memoryToken = token;
}

/** The current CSRF token: the readable cookie wins, then the remembered one. */
export function getCsrfToken(): string | null {
  return readCookie(CSRF_COOKIE) ?? memoryToken;
}

export function csrfHeaders(): Record<string, string> {
  const token = getCsrfToken();
  return token ? { [CSRF_HEADER]: token } : {};
}
