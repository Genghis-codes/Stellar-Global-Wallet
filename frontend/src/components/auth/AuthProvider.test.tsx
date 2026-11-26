import { describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthApi } from "@/lib/api/endpoints/auth";
import { MemoryTokenStore } from "@/lib/api/tokens";
import * as sep10 from "@/lib/auth/sep10";
import { WalletError, type WalletAdapter } from "@/lib/wallet/types";
import { renderWithProviders } from "@/test/render";
import { AuthProvider, useAuth } from "./AuthProvider";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

vi.mock("@/lib/auth/sep10", () => ({ signInWithSep10: vi.fn(), signOut: vi.fn() }));
const mocked = vi.mocked(sep10);

function Probe() {
  const { status, account, error, signIn, signOut } = useAuth();
  return (
    <div>
      <p>status:{status}</p>
      <p>account:{account ?? "none"}</p>
      {error && <p>error:{error}</p>}
      <button onClick={() => void signIn()}>sign in</button>
      <button onClick={() => void signOut()}>sign out</button>
    </div>
  );
}

function setup(tokens = new MemoryTokenStore(), wallet: Partial<WalletAdapter> = {}) {
  let expire: () => void = () => {};
  const onSessionExpired = (listener: () => void) => {
    expire = listener;
    return () => {};
  };
  renderWithProviders(
    <AuthProvider
      tokens={tokens}
      wallet={{ name: "Freighter", ...wallet } as WalletAdapter}
      auth={{} as AuthApi}
      networkPassphrase="Test SDF Network ; September 2015"
      onSessionExpired={onSessionExpired}
    >
      <Probe />
    </AuthProvider>,
  );
  return { tokens, expire: () => act(() => expire()) };
}

describe("AuthProvider", () => {
  it("restores an existing session", () => {
    const tokens = new MemoryTokenStore();
    tokens.set({ accessToken: "a", refreshToken: "r", account: G });
    setup(tokens);
    expect(screen.getByText("status:signedIn")).toBeInTheDocument();
    expect(screen.getByText(`account:${G}`)).toBeInTheDocument();
  });

  it("signs in through SEP-10 and reflects the stored session", async () => {
    const { tokens } = setup();
    expect(screen.getByText("status:signedOut")).toBeInTheDocument();
    mocked.signInWithSep10.mockImplementation(async (deps) => {
      const session = { accessToken: "a", refreshToken: "r", account: G };
      deps.tokens.set(session);
      return session;
    });
    await userEvent.setup().click(screen.getByText("sign in"));
    expect(await screen.findByText("status:signedIn")).toBeInTheDocument();
    expect(mocked.signInWithSep10).toHaveBeenCalledWith(expect.objectContaining({ tokens }));
  });

  it("shows sign-in failures, but stays quiet when the user rejects", async () => {
    setup();
    const user = userEvent.setup();
    mocked.signInWithSep10.mockRejectedValueOnce(new WalletError("WRONG_NETWORK", "Freighter is on Mainnet."));
    await user.click(screen.getByText("sign in"));
    expect(await screen.findByText("error:Freighter is on Mainnet.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in failed");

    mocked.signInWithSep10.mockRejectedValueOnce(new WalletError("USER_REJECTED", "Rejected."));
    await user.click(screen.getByText("sign in"));
    await waitFor(() => expect(screen.getByText("error:Rejected.")).toBeInTheDocument());
  });

  it("signs out", async () => {
    const tokens = new MemoryTokenStore();
    tokens.set({ accessToken: "a", refreshToken: "r", account: G });
    mocked.signOut.mockImplementation(async (deps) => deps.tokens.clear());
    setup(tokens);
    await userEvent.setup().click(screen.getByText("sign out"));
    expect(await screen.findByText("status:signedOut")).toBeInTheDocument();
  });

  it("shows a toast when the session expires", () => {
    const tokens = new MemoryTokenStore();
    tokens.set({ accessToken: "a", refreshToken: "r", account: G });
    const { expire } = setup(tokens);
    act(() => tokens.clear());
    expire();
    expect(screen.getByRole("status")).toHaveTextContent("Session expired");
    expect(screen.getByText("status:signedOut")).toBeInTheDocument();
  });

  it("signs out when the wallet switches account and warns on network switches", async () => {
    const tokens = new MemoryTokenStore();
    tokens.set({ accessToken: "a", refreshToken: "r", account: G });
    let push: (state: { address: string; networkPassphrase: string }) => void = () => {};
    const stop = vi.fn();
    mocked.signOut.mockImplementation(async (deps) => deps.tokens.clear());
    setup(tokens, {
      watch: (listener) => {
        push = listener;
        return stop;
      },
    });
    act(() => push({ address: G, networkPassphrase: "Public Global Stellar Network ; September 2015" }));
    expect(screen.getByText("Freighter is on another network")).toBeInTheDocument();
    act(() => push({ address: G, networkPassphrase: "Test SDF Network ; September 2015" }));
    expect(screen.queryByText("Freighter is on another network")).toBeNull();
    act(() => push({ address: "GOTHER", networkPassphrase: "Test SDF Network ; September 2015" }));
    expect(await screen.findByText("status:signedOut")).toBeInTheDocument();
    expect(screen.getByText("Freighter account changed")).toBeInTheDocument();
    expect(stop).toHaveBeenCalled();
  });
});
