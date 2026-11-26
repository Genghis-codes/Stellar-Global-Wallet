import { describe, expect, it } from "vitest";
import { callHeaders, errorResponse, jsonResponse, mockFetch } from "@/test/fetch";
import { createApiClient } from "../client";
import { isApiError } from "../errors";
import { MemoryTokenStore } from "../tokens";
import { EMAIL_ERROR_CODES, emailApi } from "./email";

function setup(...responses: Response[]) {
  const tokens = new MemoryTokenStore();
  tokens.set({ accessToken: "acc", refreshToken: "ref" });
  const fetch = mockFetch(...responses);
  const client = createApiClient({ baseUrl: "http://api.test", fetch, tokens });
  return { fetch, email: emailApi(client) };
}

describe("emailApi", () => {
  it("reads the verified email with the session token", async () => {
    const { fetch, email } = setup(jsonResponse({ email: "a@b.co", verified: true }));
    await expect(email.get()).resolves.toEqual({ email: "a@b.co", verified: true });
    expect(fetch.mock.calls[0]![0]).toBe("http://api.test/api/v1/me/email");
    expect(callHeaders(fetch).Authorization).toBe("Bearer acc");
  });

  it("submits an address for verification", async () => {
    const { fetch, email } = setup(jsonResponse({ message: "sent" }, { status: 202 }));
    await expect(email.submit("a@b.co")).resolves.toEqual({ message: "sent" });
    const init = fetch.mock.calls.at(-1)![1]!;
    expect(fetch.mock.calls.at(-1)![0]).toBe("http://api.test/api/v1/me/email");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ email: "a@b.co" });
  });

  it("verifies a token and surfaces expiry as a coded ApiError", async () => {
    const { fetch, email } = setup(
      jsonResponse({ message: "ok", email: "a@b.co" }),
      errorResponse(410, EMAIL_ERROR_CODES.tokenExpired),
    );
    await expect(email.verify("tok")).resolves.toEqual({ message: "ok", email: "a@b.co" });
    expect(fetch.mock.calls.at(-1)![0]).toBe("http://api.test/api/v1/me/email/verify");
    expect(JSON.parse(String(fetch.mock.calls.at(-1)![1]!.body))).toEqual({ token: "tok" });
    const error = await email.verify("old").catch((e: unknown) => e);
    expect(isApiError(error) && error.code).toBe(EMAIL_ERROR_CODES.tokenExpired);
  });
});
