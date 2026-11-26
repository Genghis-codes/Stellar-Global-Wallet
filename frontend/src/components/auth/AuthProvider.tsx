"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/Toast";
import { api, onSessionExpired as subscribeToSessionExpiry, tokenStore } from "@/lib/api";
import type { AuthApi } from "@/lib/api/endpoints/auth";
import { describeError } from "@/lib/api/errors";
import type { AuthTokens, TokenStore } from "@/lib/api/tokens";
import { signInWithSep10, signOut as revokeSession } from "@/lib/auth/sep10";
import { networkPassphrase as configuredPassphrase } from "@/lib/stellar/network";
import { freighter } from "@/lib/wallet/freighter";
import { isWalletError, type WalletAdapter } from "@/lib/wallet/types";

export type AuthStatus = "loading" | "signedOut" | "signedIn";

export interface AuthContextValue {
  status: AuthStatus;
  /** The signed-in G... account, or null. */
  account: string | null;
  /** True while the connect + SEP-10 flow is running. */
  signingIn: boolean;
  /** Last sign-in error, as a user-facing sentence. */
  error: string | null;
  wallet: WalletAdapter;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
  /** Injection points for tests; default to the app singletons. */
  wallet?: WalletAdapter;
  auth?: AuthApi;
  tokens?: TokenStore;
  networkPassphrase?: string;
  onSessionExpired?: (listener: () => void) => () => void;
}

const serverSnapshot = () => undefined;

export function AuthProvider({
  children,
  wallet = freighter,
  auth = api.auth,
  tokens = tokenStore,
  networkPassphrase = configuredPassphrase(),
  onSessionExpired = subscribeToSessionExpiry,
}: AuthProviderProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // undefined = not hydrated yet (server render / first client pass).
  const session = useSyncExternalStore<AuthTokens | null | undefined>(
    useCallback((listener) => tokens.subscribe(listener), [tokens]),
    () => tokens.get(),
    serverSnapshot,
  );

  useEffect(
    () =>
      onSessionExpired(() => {
        queryClient.clear();
        toast.show({
          id: "session-expired",
          tone: "warning",
          title: "Session expired",
          description: "Please sign in again to keep using GlobeWallet.",
          duration: 0,
        });
      }),
    [onSessionExpired, queryClient, toast],
  );

  const account = session?.account;

  // Switching account in the wallet ends the session for the old account;
  // switching network only warns, since signing would fail on the wrong one.
  useEffect(() => {
    if (!account || !wallet.watch) return;
    return wallet.watch(({ address, networkPassphrase: walletPassphrase }) => {
      if (address !== account) {
        void revokeSession({ auth, tokens }).then(() => queryClient.clear());
        toast.show({
          id: "wallet-account-changed",
          tone: "info",
          title: `${wallet.name} account changed`,
          description: "You were signed out. Connect again to continue with the new account.",
        });
      } else if (walletPassphrase && walletPassphrase !== networkPassphrase) {
        toast.show({
          id: "wallet-network-changed",
          tone: "warning",
          title: `${wallet.name} is on another network`,
          description: "Switch it back to sign transactions with GlobeWallet.",
        });
      } else {
        toast.dismiss("wallet-network-changed");
      }
    });
  }, [account, wallet, auth, tokens, networkPassphrase, queryClient, toast]);

  const signIn = useCallback(async () => {
    setSigningIn(true);
    setError(null);
    try {
      await signInWithSep10({ wallet, auth, tokens, networkPassphrase });
      toast.dismiss("session-expired");
      return true;
    } catch (err) {
      const message = describeError(err);
      setError(message);
      if (!isWalletError(err) || err.code !== "USER_REJECTED") {
        toast.show({ tone: "danger", title: "Sign-in failed", description: message });
      }
      return false;
    } finally {
      setSigningIn(false);
    }
  }, [wallet, auth, tokens, networkPassphrase, toast]);

  const signOut = useCallback(async () => {
    await revokeSession({ auth, tokens });
    queryClient.clear();
  }, [auth, tokens, queryClient]);

  const value = useMemo<AuthContextValue>(() => {
    const status: AuthStatus = session === undefined ? "loading" : session ? "signedIn" : "signedOut";
    return {
      status,
      account: session?.account ?? null,
      signingIn,
      error,
      wallet,
      signIn,
      signOut,
    };
  }, [session, signingIn, error, wallet, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
