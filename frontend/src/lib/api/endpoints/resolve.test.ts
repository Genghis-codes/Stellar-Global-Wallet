import { describe, expect, it } from "vitest";
import { errorResponse, jsonResponse, mockFetch } from "@/test/fetch";
import { createApiClient } from "../client";
import { resolveApi } from "./resolve";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

describe("resolveApi", () => {
  it("resolves a federation address through the query string", async () => {
    const fetch = mockFetch(
      jsonResponse({ query: "bob*example.com", type: "federation", accountId: G, memo: "42", memoType: "id" }),
    );
    const resolve = resolveApi(createApiClient({ baseUrl: "http://api.test", fetch }));
    const result = await resolve.resolve("  bob*example.com ");

    expect(fetch.mock.calls[0]![0]).toBe("http://api.test/api/v1/resolve?q=bob*example.com");
    expect(fetch.mock.calls[0]![1]?.method).toBe("GET");
    expect(result).toMatchObject({ type: "federation", accountId: G, memoType: "id" });
  });

  it("maps federation failures to ApiErrors", async () => {
    const fetch = mockFetch(errorResponse(502, "FEDERATION_UNAVAILABLE"));
    const resolve = resolveApi(createApiClient({ baseUrl: "http://api.test", fetch }));
    await expect(resolve.resolve("nobody*example.com")).rejects.toMatchObject({ code: "FEDERATION_UNAVAILABLE", status: 502 });
  });
});
