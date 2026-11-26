import { afterEach, describe, expect, it } from "vitest";
import { callHeaders, jsonResponse, mockFetch } from "@/test/fetch";
import { createApiClient } from "./client";
import { CSRF_HEADER, csrfHeaders, isUnsafeMethod, readCookie, setCsrfToken } from "./csrf";

function setCookie(value: string) {
  document.cookie = value;
}

afterEach(() => {
  setCsrfToken(null);
  setCookie("gw_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/");
});

describe("csrf helpers", () => {
  it("classifies methods", () => {
    expect(isUnsafeMethod("get")).toBe(false);
    expect(isUnsafeMethod("POST")).toBe(true);
    expect(isUnsafeMethod("DELETE")).toBe(true);
  });

  it("reads and decodes cookies", () => {
    expect(readCookie("gw_csrf", "a=1; gw_csrf=t%20k; b=2")).toBe("t k");
    expect(readCookie("gw_csrf", "a=1")).toBeNull();
    expect(readCookie("gw_csrf", "gw_csrf=%E0%A4%A")).toBeNull();
  });

  it("prefers the cookie over the remembered token", () => {
    setCsrfToken("memory");
    expect(csrfHeaders()).toEqual({ [CSRF_HEADER]: "memory" });
    setCookie("gw_csrf=cookie; path=/");
    expect(csrfHeaders()).toEqual({ [CSRF_HEADER]: "cookie" });
  });
});

describe("client CSRF handling", () => {
  it("adds the header to unsafe requests only", async () => {
    setCookie("gw_csrf=tok; path=/");
    const fetch = mockFetch(jsonResponse({}), jsonResponse({}));
    const client = createApiClient({ baseUrl: "http://api.test", fetch });
    await client.get("/a");
    await client.put("/b", {});
    expect(callHeaders(fetch, 0)[CSRF_HEADER]).toBeUndefined();
    expect(callHeaders(fetch, 1)[CSRF_HEADER]).toBe("tok");
  });

  it("fetches and remembers a token from /auth/csrf", async () => {
    const fetch = mockFetch(jsonResponse({ csrfToken: "fresh" }), jsonResponse({}));
    const client = createApiClient({ baseUrl: "http://api.test", fetch });
    await expect(client.ensureCsrfToken()).resolves.toBe("fresh");
    expect(fetch.mock.calls[0]![0]).toBe("http://api.test/auth/csrf");
    await client.post("/c");
    expect(callHeaders(fetch, 1)[CSRF_HEADER]).toBe("fresh");
  });
});
