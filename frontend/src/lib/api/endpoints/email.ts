import type { ApiClient } from "../client";

/**
 * /api/v1/me/email — the signed-in account's notification email
 * (backend/src/routes/email.ts). Submitting an address sends a verification
 * link with a token; the token is confirmed with `verify`. Submitting a new
 * address replaces the pending one. The backend has no delete route.
 */
export interface EmailStatus {
  /** The verified address, or null when none is verified yet. */
  email: string | null;
  verified: boolean;
}

export interface EmailVerifyResponse {
  message: string;
  email: string;
}

/** Error codes the email routes answer with (branch on these, not messages). */
export const EMAIL_ERROR_CODES = {
  alreadyVerified: "EMAIL_ALREADY_VERIFIED",
  tokenExpired: "EMAIL_TOKEN_EXPIRED",
  tokenInvalid: "EMAIL_TOKEN_INVALID",
} as const;

export function emailApi(client: ApiClient) {
  return {
    /** GET /api/v1/me/email */
    get(signal?: AbortSignal) {
      return client.get<EmailStatus>("/api/v1/me/email", { signal });
    },

    /** POST /api/v1/me/email (202): send a verification link to `email`. */
    submit(email: string) {
      return client.post<{ message: string }>("/api/v1/me/email", { email });
    },

    /** POST /api/v1/me/email/verify: confirm the token from the link. */
    verify(token: string) {
      return client.post<EmailVerifyResponse>("/api/v1/me/email/verify", { token });
    },
  };
}

export type EmailApi = ReturnType<typeof emailApi>;
