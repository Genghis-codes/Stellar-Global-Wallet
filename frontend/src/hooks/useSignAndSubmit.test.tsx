import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { networkPassphrase } from "@/lib/stellar/network";
import { WalletError } from "@/lib/wallet/types";
import { isUserRejection, phaseLabel, useSignAndSubmit } from "./useSignAndSubmit";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const signTransaction = vi.fn(async (xdr: string, _opts?: unknown) => `signed:${xdr}`);
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction } }) }));

const wrapper = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>;

beforeEach(() => signTransaction.mockClear());

describe("useSignAndSubmit", () => {
  it("builds, signs with the wallet and submits", async () => {
    const submit = vi.fn().mockResolvedValue({ hash: "h", successful: true });
    const { result } = renderHook(() => useSignAndSubmit(), { wrapper });
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.run({ build: async () => ({ xdr: "TX" }), submit });
    });
    expect(signTransaction).toHaveBeenCalledWith("TX", { networkPassphrase: networkPassphrase(), address: G });
    expect(submit).toHaveBeenCalledWith("signed:TX");
    expect(outcome).toEqual({ hash: "h", successful: true });
    expect(result.current.phase).toBe("idle");
  });

  it("signs and submits a restore transaction first", async () => {
    const submit = vi.fn().mockResolvedValue({ hash: "h", successful: true });
    const { result } = renderHook(() => useSignAndSubmit(), { wrapper });
    await act(() =>
      result.current.run({
        build: async () => ({ xdr: "TX", networkPassphrase: "custom", restore: { transactionXdr: "RESTORE" } }),
        submit,
      }),
    );
    expect(submit.mock.calls.map((call) => call[0])).toEqual(["signed:RESTORE", "signed:TX"]);
    expect(signTransaction.mock.calls[0]![1]).toEqual({ networkPassphrase: "custom", address: G });
  });

  it("stops when the user rejects in the wallet and resets the phase", async () => {
    signTransaction.mockRejectedValueOnce(new WalletError("USER_REJECTED", "nope"));
    const submit = vi.fn();
    const { result } = renderHook(() => useSignAndSubmit(), { wrapper });
    await act(async () => {
      await expect(result.current.run({ build: async () => ({ xdr: "TX" }), submit })).rejects.toSatisfy(isUserRejection);
    });
    expect(submit).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });
});

describe("phaseLabel", () => {
  it("names each phase", () => {
    expect(phaseLabel("idle", "Save")).toBe("Save");
    expect(phaseLabel("signing", "Save")).toBe("Confirm in wallet…");
    expect(phaseLabel("submitting", "Save")).toBe("Submitting…");
  });
});
