import type { ApiClient } from "../client";

/**
 * /api/v1/auth — SEP-10 web authentication (backend/src/routes/auth.ts).
 *
 * Flow: getChallenge(account) -> sign `transaction` with the wallet ->
 * submitChallenge(signedXdr) -> store the token pair. Refresh is handled by
 * the client automatically; logout revokes the refresh token server-side.
 */

export interface ChallengeResponse {
  /** Base64 XDR of the SEP-10 challenge transaction to sign. */
  transaction: string;
  networkPassphrase: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  /** The authenticated G... account (JWT `sub`). */
  account: string;
  auth_method: "sep10";
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
}

export function authApi(client: ApiClient) {
  return {
    /** GET /api/v1/auth/challenge?account=G... */
    getChallenge(account: string, signal?: AbortSignal) {
      return client.get<ChallengeResponse>("/api/v1/auth/challenge", { query: { account }, auth: false, signal });
    },

    /** POST /api/v1/auth/token — exchange a signed challenge for a token pair. */
    submitChallenge(transaction: string) {
      return client.post<TokenResponse>("/api/v1/auth/token", { transaction }, { auth: false });
    },

    /** POST /api/v1/auth/refresh — rotate the token pair (the client does this on TOKEN_EXPIRED). */
    refresh(refreshToken: string) {
      return client.post<RefreshResponse>("/api/v1/auth/refresh", { refreshToken }, { auth: false });
    },

    /** POST /api/v1/auth/logout — revoke the refresh token. */
    logout(refreshToken: string) {
      return client.post<{ message: string }>("/api/v1/auth/logout", { refreshToken }, { auth: false });
    },

    /** GET /auth/csrf — make sure a double-submit CSRF token is available. */
    ensureCsrfToken() {
      return client.ensureCsrfToken();
    },
  };
}

export type AuthApi = ReturnType<typeof authApi>;
