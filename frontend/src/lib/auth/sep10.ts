import { TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import type { AuthApi } from "@/lib/api/endpoints/auth";
import type { AuthTokens, TokenStore } from "@/lib/api/tokens";
import { assertWalletNetwork } from "@/lib/wallet/network";
import type { WalletAdapter } from "@/lib/wallet/types";

/**
 * SEP-10 sign-in against the backend (backend/src/routes/auth.ts):
 *
 *   1. connect the wallet and check it is on the expected network
 *   2. GET  /api/v1/auth/challenge?account=G...   -> challenge XDR
 *   3. sanity-check the challenge, then sign it with the wallet
 *   4. POST /api/v1/auth/token { transaction }     -> access + refresh token
 *   5. store the session
 */

export class Sep10Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Sep10Error";
  }
}

export interface Sep10Deps {
  wallet: WalletAdapter;
  auth: AuthApi;
  tokens: TokenStore;
  /** Passphrase of the network the app is configured for. */
  networkPassphrase: string;
}

/**
 * Defence in depth before asking the user to sign: a SEP-10 challenge is a
 * sequence-0 transaction made only of manage_data operations, the first of
 * which is sourced by the client account. Anything else could be a real
 * transaction disguised as a login, so refuse to sign it. (The backend
 * performs the full SEP-10 verification on submit.)
 */
export function assertLooksLikeChallenge(xdr: string, account: string, networkPassphrase: string): void {
  let tx: Transaction;
  try {
    const parsed = TransactionBuilder.fromXDR(xdr, networkPassphrase);
    if (!("operations" in parsed) || "innerTransaction" in parsed) throw new Error("fee bump");
    tx = parsed as Transaction;
  } catch {
    throw new Sep10Error("The server sent an invalid sign-in challenge.");
  }
  if (tx.sequence !== "0") throw new Sep10Error("The sign-in challenge has a non-zero sequence number.");
  if (tx.operations.length === 0 || tx.operations.some((op) => op.type !== "manageData")) {
    throw new Sep10Error("The sign-in challenge contains unexpected operations.");
  }
  if (tx.operations[0]?.source !== account) {
    throw new Sep10Error("The sign-in challenge is not for this account.");
  }
}

export async function signInWithSep10(deps: Sep10Deps): Promise<AuthTokens> {
  const { wallet, auth, tokens, networkPassphrase } = deps;

  const account = await wallet.connect();
  await assertWalletNetwork(wallet, networkPassphrase);

  const challenge = await auth.getChallenge(account);
  if (challenge.networkPassphrase !== networkPassphrase) {
    throw new Sep10Error(
      "The GlobeWallet server is configured for a different Stellar network than this app. Check NEXT_PUBLIC_STELLAR_NETWORK.",
    );
  }
  assertLooksLikeChallenge(challenge.transaction, account, networkPassphrase);

  const signed = await wallet.signTransaction(challenge.transaction, { networkPassphrase, address: account });
  const issued = await auth.submitChallenge(signed);
  if (issued.account !== account) {
    throw new Sep10Error("The server issued a session for a different account.");
  }

  const session: AuthTokens = { accessToken: issued.accessToken, refreshToken: issued.refreshToken, account };
  tokens.set(session);
  return session;
}

/** Revoke the refresh token server-side (best effort) and forget the session. */
export async function signOut(deps: Pick<Sep10Deps, "auth" | "tokens">): Promise<void> {
  const current = deps.tokens.get();
  deps.tokens.clear();
  if (current?.refreshToken) {
    try {
      await deps.auth.logout(current.refreshToken);
    } catch {
      // Already signed out locally; an unreachable server must not block logout.
    }
  }
}
