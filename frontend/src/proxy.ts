import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { buildCsp, createNonce, CSP_REPORT_GROUP, cspReportUrl } from "@/lib/security/csp";

/**
 * Sets a per-request nonce-based Content-Security-Policy (see
 * backend/docs/security/csp.md). Next.js reads the CSP from the request
 * headers and adds the nonce to its own scripts; the root layout reads
 * `x-nonce` for the theme script.
 */
export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildCsp({
    nonce,
    apiUrl: env.apiUrl,
    horizonUrl: env.horizonUrl,
    isDev: process.env.NODE_ENV === "development",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Reporting-Endpoints", `${CSP_REPORT_GROUP}="${cspReportUrl(env.apiUrl)}"`);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
