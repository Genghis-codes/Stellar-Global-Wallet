import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { api } from "@/lib/api";
import { testQueryClient } from "@/test/render";
import { TransactionFailedError, useAccountTransaction } from "./useAccountTransaction";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const signTransaction = vi.fn(async (xdr: string, _opts?: unknown) => `signed:${xdr}`);
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction } }) }));

const client = testQueryClient();
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.restoreAllMocks());

describe("useAccountTransaction", () => {
  it("signs the built XDR, submits it for the account and refreshes account data", async () => {
    const submit = vi.spyOn(api.wallet, "submit").mockResolvedValue({ hash: "h1", successful: true });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useAccountTransaction(G), { wrapper });
    await expect(result.current.execute(async () => ({ xdr: "TX", networkPassphrase: "Test" }))).resolves.toEqual({ hash: "h1", pending: false });
    expect(signTransaction).toHaveBeenCalledWith("TX", { networkPassphrase: "Test", address: G });
    expect(submit).toHaveBeenCalledWith("signed:TX", { account: G });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["account", G] });
  });

  it("reports pending submissions and failed transactions", async () => {
    vi.spyOn(api.wallet, "submit")
      .mockResolvedValueOnce({ hash: "h2", status: "pending" })
      .mockResolvedValueOnce({ hash: "h3", successful: false });
    const { result } = renderHook(() => useAccountTransaction(G), { wrapper });
    await expect(result.current.execute(async () => ({ xdr: "TX" }))).resolves.toEqual({ hash: "h2", pending: true });
    await expect(result.current.execute(async () => ({ xdr: "TX" }))).rejects.toBeInstanceOf(TransactionFailedError);
  });
});
