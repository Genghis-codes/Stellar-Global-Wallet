import { describe, expect, it } from "vitest";
import { buildCsp, createNonce, cspReportUrl } from "./csp";

function directives(csp: string): Record<string, string[]> {
  return Object.fromEntries(
    csp.split("; ").map((d) => {
      const [name = "", ...values] = d.split(" ");
      return [name, values];
    })
  );
}

const base = { nonce: "abc123", apiUrl: "https://api.example.com/", horizonUrl: "https://horizon-testnet.stellar.org" };

describe("buildCsp", () => {
  it("uses nonces, never unsafe-inline or wildcards, in production", () => {
    const csp = buildCsp(base);
    const d = directives(csp);
    expect(d["script-src"]).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(d["style-src"]).toEqual(["'self'", "'nonce-abc123'"]);
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/\s\*(\s|;|$)/);
  });

  it("allows the API, Horizon and Soroban RPC and blocks framing", () => {
    const d = directives(buildCsp({ ...base, horizonUrl: "https://my-horizon.example.org/path" }));
    expect(d["connect-src"]).toContain("https://api.example.com");
    expect(d["connect-src"]).toContain("https://my-horizon.example.org");
    expect(d["connect-src"]).toContain("https://soroban-testnet.stellar.org");
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["report-uri"]).toEqual(["https://api.example.com/api/v1/csp-report"]);
  });

  it("relaxes only what development needs", () => {
    const d = directives(buildCsp({ ...base, isDev: true }));
    expect(d["script-src"]).toContain("'unsafe-eval'");
    expect(d["connect-src"]).toContain("ws:");
  });

  it("creates unique nonces and report URLs", () => {
    expect(createNonce()).not.toBe(createNonce());
    expect(createNonce()).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(cspReportUrl("http://localhost:4000")).toBe("http://localhost:4000/api/v1/csp-report");
  });
});
