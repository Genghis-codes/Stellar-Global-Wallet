import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WalletAdapter } from "@/lib/wallet/types";
import type { AuthContextValue } from "./AuthProvider";
import { ConnectWallet } from "./ConnectWallet";

const replace = vi.fn();
let auth: AuthContextValue;
let params = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => params,
}));
vi.mock("./AuthProvider", () => ({ useAuth: () => auth }));

function makeAuth(overrides: Partial<AuthContextValue> = {}, available = true): AuthContextValue {
  return {
    status: "signedOut",
    account: null,
    signingIn: false,
    error: null,
    wallet: {
      name: "Freighter",
      installUrl: "https://www.freighter.app/",
      isAvailable: vi.fn(async () => available),
    } as unknown as WalletAdapter,
    signIn: vi.fn(async () => true),
    signOut: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  replace.mockReset();
  params = new URLSearchParams();
});

describe("ConnectWallet", () => {
  it("starts the sign-in flow", async () => {
    auth = makeAuth();
    render(<ConnectWallet />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Connect Freighter" }));
    expect(auth.signIn).toHaveBeenCalled();
  });

  it("offers an install link when Freighter is missing", async () => {
    auth = makeAuth({}, false);
    render(<ConnectWallet />);
    expect(await screen.findByRole("link", { name: "Install Freighter" })).toHaveAttribute(
      "href",
      "https://www.freighter.app/",
    );
  });

  it("shows the last error", () => {
    auth = makeAuth({ error: "Freighter is on Mainnet." });
    render(<ConnectWallet />);
    expect(screen.getByRole("alert")).toHaveTextContent("Freighter is on Mainnet.");
  });

  it("redirects a signed-in user to the safe next path", () => {
    params = new URLSearchParams({ next: "//evil.example" });
    auth = makeAuth({ status: "signedIn" });
    render(<ConnectWallet />);
    expect(replace).toHaveBeenCalledWith("/dashboard");
  });
});
