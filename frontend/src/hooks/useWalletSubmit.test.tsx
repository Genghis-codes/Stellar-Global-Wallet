import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { networkPassphrase } from "@/lib/stellar/network";
import { testQueryClient } from "@/test/render";
import { useWalletSubmit } from "./useWalletSubmit";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const signTransaction = vi.fn();

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction } }) }));
vi.mock("@/lib/stellar/feeBump", () => ({
  needsFeeBump: (_xdr: string, _passphrase: string, fee: string) => BigInt(fee) > 100n,
  buildFeeBump: () => "BUMP",
}));

const queryClient = testQueryClient();
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.restoreAllMocks();
  signTransaction.mockReset();
});

describe("useWalletSubmit", () => {
  it("signs, submits with the idempotency key and refreshes the account", async () => {
    signTransaction.mockResolvedValue("SIGNED");
    const submit = vi.spyOn(api.wallet, "submit").mockResolvedValue({ hash: "h", successful: true });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useWalletSubmit(), { wrapper });

    result.current.mutate({ xdr: "UNSIGNED", networkPassphrase: networkPassphrase(), idempotencyKey: "k1" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(signTransaction).toHaveBeenCalledWith("UNSIGNED", { networkPassphrase: networkPassphrase(), address: G });
    expect(submit).toHaveBeenCalledWith("SIGNED", { account: G, idempotencyKey: "k1" });
    expect(result.current.data).toEqual({ result: { hash: "h", successful: true }, signedXdr: "SIGNED", submittedXdr: "SIGNED" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["account", G] });
  });

  it("wraps the signed envelope in a fee bump when the chosen fee is higher", async () => {
    signTransaction.mockResolvedValueOnce("SIGNED").mockResolvedValueOnce("SIGNED_BUMP");
    const submit = vi.spyOn(api.wallet, "submit").mockResolvedValue({ hash: "h", status: "pending" });
    const { result } = renderHook(() => useWalletSubmit(), { wrapper });

    result.current.mutate({ xdr: "UNSIGNED", networkPassphrase: networkPassphrase(), perOperationFee: "500", idempotencyKey: "k2" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(signTransaction).toHaveBeenLastCalledWith("BUMP", expect.anything());
    expect(submit).toHaveBeenCalledWith("SIGNED_BUMP", { account: G, idempotencyKey: "k2" });
    expect(result.current.data?.signedXdr).toBe("SIGNED");
  });

  it("refuses a build for another network before asking the wallet", async () => {
    const { result } = renderHook(() => useWalletSubmit(), { wrapper });
    result.current.mutate({ xdr: "UNSIGNED", networkPassphrase: "Other Network", idempotencyKey: "k3" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ code: "WRONG_NETWORK" });
    expect(signTransaction).not.toHaveBeenCalled();
  });
});
