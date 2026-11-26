import { describe, expect, it } from "vitest";
import { callHeaders, jsonResponse, mockFetch } from "@/test/fetch";
import { createApiClient } from "../client";
import { MemoryTokenStore } from "../tokens";
import { authApi } from "./auth";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

function setup(...responses: Response[]) {
  const fetch = mockFetch(...responses);
  const tokens = new MemoryTokenStore();
  tokens.set({ accessToken: "acc", refreshToken: "ref" });
  return { fetch, auth: authApi(createApiClient({ baseUrl: "http://api.test", fetch, tokens })) };
}

describe("authApi", () => {
  it("requests a challenge anonymously", async () => {
    const { fetch, auth } = setup(jsonResponse({ transaction: "AAA", networkPassphrase: "Test SDF Network ; September 2015" }));
    await expect(auth.getChallenge(G)).resolves.toMatchObject({ transaction: "AAA" });
    expect(fetch.mock.calls[0]![0]).toBe(`http://api.test/api/v1/auth/challenge?account=${G}`);
    expect(callHeaders(fetch).Authorization).toBeUndefined();
  });

  it("submits the signed challenge", async () => {
    const { fetch, auth } = setup(
      jsonResponse({ accessToken: "a", refreshToken: "r", tokenType: "Bearer", account: G, auth_method: "sep10" }),
    );
    await expect(auth.submitChallenge("SIGNED")).resolves.toMatchObject({ account: G });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://api.test/api/v1/auth/token");
    expect(init?.body).toBe('{"transaction":"SIGNED"}');
  });

  it("revokes the refresh token on logout", async () => {
    const { fetch, auth } = setup(jsonResponse({ message: "Logged out" }));
    await auth.logout("ref");
    expect(fetch.mock.calls[0]![0]).toBe("http://api.test/api/v1/auth/logout");
    expect(fetch.mock.calls[0]![1]?.body).toBe('{"refreshToken":"ref"}');
  });
});
