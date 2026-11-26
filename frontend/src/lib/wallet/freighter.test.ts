import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@stellar/freighter-api";
import { freighter, toWalletError } from "./freighter";
import { assertWalletNetwork, checkWalletNetwork } from "./network";

vi.mock("@stellar/freighter-api", () => ({
  isConnected: vi.fn(),
  isAllowed: vi.fn(),
  requestAccess: vi.fn(),
  getAddress: vi.fn(),
  getNetworkDetails: vi.fn(),
  signTransaction: vi.fn(),
  WatchWalletChanges: vi.fn(function (this: Record<string, unknown>) {
    this.watch = (cb: (p: Record<string, unknown>) => void) => {
      cb({ address: "", networkPassphrase: "", error: { code: -1, message: "locked" } });
      cb({ address: "GNEW", networkPassphrase: "Test SDF Network ; September 2015" });
      return {};
    };
    this.stop = stopWatch;
  }),
}));

const stopWatch = vi.hoisted(() => vi.fn());

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const TESTNET = "Test SDF Network ; September 2015";
const PUBNET = "Public Global Stellar Network ; September 2015";
const mocked = vi.mocked(api);

beforeEach(() => {
  mocked.isConnected.mockResolvedValue({ isConnected: true });
  mocked.isAllowed.mockResolvedValue({ isAllowed: true });
});

describe("freighter adapter", () => {
  it("connects and returns the shared address", async () => {
    mocked.requestAccess.mockResolvedValue({ address: G });
    await expect(freighter.connect()).resolves.toBe(G);
  });

  it("reports a missing extension", async () => {
    mocked.isConnected.mockResolvedValue({ isConnected: false });
    await expect(freighter.connect()).rejects.toMatchObject({ code: "NOT_INSTALLED" });
    await expect(freighter.isAvailable()).resolves.toBe(false);
  });

  it("maps a declined request to USER_REJECTED", async () => {
    mocked.requestAccess.mockResolvedValue({ address: "", error: { code: -4, message: "The user rejected this request." } });
    await expect(freighter.connect()).rejects.toMatchObject({ code: "USER_REJECTED" });
  });

  it("returns null for the address when the site is not allowed", async () => {
    mocked.isAllowed.mockResolvedValue({ isAllowed: false });
    await expect(freighter.getAddress()).resolves.toBeNull();
    expect(mocked.getAddress).not.toHaveBeenCalled();
  });

  it("signs with the given passphrase and address", async () => {
    mocked.signTransaction.mockResolvedValue({ signedTxXdr: "SIGNED", signerAddress: G });
    await expect(freighter.signTransaction("XDR", { networkPassphrase: TESTNET, address: G })).resolves.toBe("SIGNED");
    expect(mocked.signTransaction).toHaveBeenCalledWith("XDR", { networkPassphrase: TESTNET, address: G });
  });

  it("forwards account switches and stops watching", () => {
    const listener = vi.fn();
    const stop = freighter.watch!(listener);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ address: "GNEW", networkPassphrase: TESTNET });
    stop();
    expect(stopWatch).toHaveBeenCalled();
  });

  it("maps generic errors to UNKNOWN", () => {
    expect(toWalletError({ code: -1, message: "boom" }, "fallback")).toMatchObject({ code: "UNKNOWN", message: "boom" });
    expect(toWalletError(undefined, "fallback")).toMatchObject({ message: "fallback" });
  });
});

describe("network check", () => {
  it("passes when the passphrases match", async () => {
    mocked.getNetworkDetails.mockResolvedValue({ network: "TESTNET", networkUrl: "", networkPassphrase: TESTNET });
    await expect(checkWalletNetwork(freighter, TESTNET)).resolves.toMatchObject({ ok: true, walletLabel: "Testnet" });
  });

  it("throws WRONG_NETWORK with both network names", async () => {
    mocked.getNetworkDetails.mockResolvedValue({ network: "PUBLIC", networkUrl: "", networkPassphrase: PUBNET });
    await expect(assertWalletNetwork(freighter, TESTNET)).rejects.toMatchObject({
      code: "WRONG_NETWORK",
      message: expect.stringMatching(/on Mainnet.*Switch it to Testnet/),
    });
  });
});
