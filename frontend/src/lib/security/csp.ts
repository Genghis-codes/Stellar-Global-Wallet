/**
 * Content-Security-Policy for the web app, following
 * backend/docs/security/csp.md: nonces instead of 'unsafe-inline', an
 * explicit connect-src allow-list (this API, Horizon, Soroban RPC), no
 * framing, and violation reports sent to the backend's /api/v1/csp-report.
 */

export interface CspOptions {
  /** Per-request nonce (base64). */
  nonce: string;
  apiUrl: string;
  horizonUrl: string;
  /** Development needs 'unsafe-eval' (React debugging) and inline styles (error overlay). */
  isDev?: boolean;
}

/** Horizon and Soroban RPC hosts listed in csp.md, plus the configured Horizon. */
const STELLAR_ORIGINS = [
  "https://horizon-testnet.stellar.org",
  "https://horizon.stellar.org",
  "https://soroban-testnet.stellar.org",
  "https://soroban-rpc.stellar.org",
];

export const CSP_REPORT_GROUP = "csp-endpoint";

function origin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function cspReportUrl(apiUrl: string): string {
  return `${origin(apiUrl) ?? ""}/api/v1/csp-report`;
}

export function buildCsp({ nonce, apiUrl, horizonUrl, isDev = false }: CspOptions): string {
  const connect = new Set(["'self'", ...STELLAR_ORIGINS]);
  for (const url of [apiUrl, horizonUrl]) {
    const o = origin(url);
    if (o) connect.add(o);
  }
  if (isDev) connect.add("ws:"); // Next.js hot reload

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", ...(isDev ? ["'unsafe-inline'"] : [`'nonce-${nonce}'`])],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": [...connect],
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "report-to": [CSP_REPORT_GROUP],
    "report-uri": [cspReportUrl(apiUrl)],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

/** A fresh base64 nonce (Web Crypto, so it works in the proxy's edge runtime). */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
