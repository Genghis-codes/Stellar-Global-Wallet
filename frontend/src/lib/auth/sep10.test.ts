// @vitest-environment node
// stellar-base checks `instanceof Uint8Array`, which fails across the jsdom realm.
import { describe, expect, it, vi } from "vitest";
import { Account, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import type { AuthApi } from "@/lib/api/endpoints/auth";
import { MemoryTokenStore } from "@/lib/api/tokens";
import type { WalletAdapter } from "@/lib/wallet/types";
import { assertLooksLikeChallenge, signInWithSep10, signOut } from "./sep10";

const server = Keypair.random();
const user = Keypair.random();
const PASS = Networks.TESTNET;

function challengeXdr(opts: { source?: string; sequence?: string } = {}) {
  const account = new Account(server.publicKey(), opts.sequence ?? "-1");
  const builder = new TransactionBuilder(account, { fee: "100", networkPassphrase: PASS }).setTimeout(300);
  builder.addOperation(
    Operation.manageData({ name: "localhost auth", value: "nonce", source: opts.source ?? user.publicKey() }),
  );
  builder.addOperation(Operation.manageData({ name: "web_auth_domain", value: "localhost", source: server.publicKey() }));
  const tx = builder.build();
  tx.sign(server);
  return tx.toXDR();
}

function wallet(overrides: Partial<WalletAdapter> = {}): WalletAdapter {
  return {
    id: "test",
    name: "Test Wallet",
    installUrl: "",
    isAvailable: vi.fn(async () => true),
    connect: vi.fn(async () => user.publicKey()),
    getAddress: vi.fn(async () => user.publicKey()),
    getNetwork: vi.fn(async () => ({ network: "TESTNET", networkPassphrase: PASS })),
    signTransaction: vi.fn(async () => "SIGNED_XDR"),
    ...overrides,
  };
}

function authApi(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    getChallenge: vi.fn(async () => ({ transaction: challengeXdr(), networkPassphrase: PASS })),
    submitChallenge: vi.fn(async () => ({
      accessToken: "acc",
      refreshToken: "ref",
      tokenType: "Bearer" as const,
      account: user.publicKey(),
      auth_method: "sep10" as const,
    })),
    refresh: vi.fn(),
    logout: vi.fn(async () => ({ message: "Logged out" })),
    ensureCsrfToken: vi.fn(),
    ...overrides,
  };
}

describe("assertLooksLikeChallenge", () => {
  it("accepts a well-formed challenge", () => {
    expect(() => assertLooksLikeChallenge(challengeXdr(), user.publicKey(), PASS)).not.toThrow();
  });

  it("rejects garbage, other accounts and non-manage_data operations", () => {
    expect(() => assertLooksLikeChallenge("not-xdr", user.publicKey(), PASS)).toThrow(/invalid/);
    expect(() => assertLooksLikeChallenge(challengeXdr({ source: server.publicKey() }), user.publicKey(), PASS)).toThrow(
      /not for this account/,
    );
    expect(() => assertLooksLikeChallenge(challengeXdr({ sequence: "5" }), user.publicKey(), PASS)).toThrow(/sequence/);
  });
});

describe("signInWithSep10", () => {
  it("runs the full challenge flow and stores the session", async () => {
    const tokens = new MemoryTokenStore();
    const w = wallet();
    const auth = authApi();
    const session = await signInWithSep10({ wallet: w, auth, tokens, networkPassphrase: PASS });
    expect(session).toEqual({ accessToken: "acc", refreshToken: "ref", account: user.publicKey() });
    expect(tokens.get()).toEqual(session);
    expect(auth.getChallenge).toHaveBeenCalledWith(user.publicKey());
    expect(w.signTransaction).toHaveBeenCalledWith(expect.any(String), {
      networkPassphrase: PASS,
      address: user.publicKey(),
    });
    expect(auth.submitChallenge).toHaveBeenCalledWith("SIGNED_XDR");
  });

  it("stops before signing when the wallet is on the wrong network", async () => {
    const w = wallet({ getNetwork: vi.fn(async () => ({ network: "PUBLIC", networkPassphrase: Networks.PUBLIC })) });
    const auth = authApi();
    await expect(
      signInWithSep10({ wallet: w, auth, tokens: new MemoryTokenStore(), networkPassphrase: PASS }),
    ).rejects.toMatchObject({ code: "WRONG_NETWORK" });
    expect(auth.getChallenge).not.toHaveBeenCalled();
  });

  it("refuses a backend on another network", async () => {
    const auth = authApi({ getChallenge: vi.fn(async () => ({ transaction: challengeXdr(), networkPassphrase: Networks.PUBLIC })) });
    const w = wallet();
    await expect(
      signInWithSep10({ wallet: w, auth, tokens: new MemoryTokenStore(), networkPassphrase: PASS }),
    ).rejects.toThrow(/different Stellar network/);
    expect(w.signTransaction).not.toHaveBeenCalled();
  });

  it("does not store a session issued for another account", async () => {
    const tokens = new MemoryTokenStore();
    const auth = authApi({
      submitChallenge: vi.fn(async () => ({
        accessToken: "a",
        refreshToken: "r",
        tokenType: "Bearer" as const,
        account: server.publicKey(),
        auth_method: "sep10" as const,
      })),
    });
    await expect(signInWithSep10({ wallet: wallet(), auth, tokens, networkPassphrase: PASS })).rejects.toThrow(
      /different account/,
    );
    expect(tokens.get()).toBeNull();
  });
});

describe("signOut", () => {
  it("clears locally even if the server call fails", async () => {
    const tokens = new MemoryTokenStore();
    tokens.set({ accessToken: "a", refreshToken: "r" });
    const auth = authApi({ logout: vi.fn(async () => Promise.reject(new Error("offline"))) });
    await signOut({ auth, tokens });
    expect(tokens.get()).toBeNull();
    expect(auth.logout).toHaveBeenCalledWith("r");
  });
});
