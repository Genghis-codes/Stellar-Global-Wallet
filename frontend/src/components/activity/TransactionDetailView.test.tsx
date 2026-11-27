import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import type { TransactionDetail } from "@/lib/api/endpoints/transactions";
import { renderWithProviders } from "@/test/render";
import { TransactionDetailView } from "./TransactionDetailView";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const HASH = "e".repeat(64);

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G }) }));
vi.mock("@/lib/stellar/horizon", () => ({ fetchTransactionSignatures: vi.fn(async () => ["c2lnbmF0dXJl"]) }));

const detail: TransactionDetail = {
  hash: HASH,
  ledger: 1234,
  createdAt: "2026-02-01T10:00:00Z",
  successful: true,
  sourceAccount: G,
  feeAccount: G,
  fee: "0.0000100",
  maxFee: "0.0001000",
  memo: "invoice 7",
  memoType: "text",
  operationCount: 1,
  perspective: G,
  operations: [],
  explorerUrl: `https://stellar.expert/explorer/testnet/tx/${HASH}`,
};

beforeEach(() => vi.restoreAllMocks());

describe("TransactionDetailView", () => {
  it("shows status, memo, fee and the explorer link", async () => {
    const get = vi.spyOn(api.transactions, "get").mockResolvedValue(detail);
    renderWithProviders(<TransactionDetailView hash={HASH} />);
    expect(await screen.findByText("Successful")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(HASH, G, expect.anything());
    expect(screen.getByText("invoice 7")).toBeInTheDocument();
    expect(screen.getByText("Ledger").nextSibling).toHaveTextContent("1234");
    expect(screen.getByText("Fee").nextSibling).toHaveTextContent("0.00001XLM");
    expect(screen.getByRole("link", { name: /View on explorer/ })).toHaveAttribute("href", detail.explorerUrl);
    expect(await screen.findByText("c2lnbmF0dXJl")).toBeInTheDocument();
  });

  it("marks failed transactions", async () => {
    vi.spyOn(api.transactions, "get").mockResolvedValue({ ...detail, successful: false });
    renderWithProviders(<TransactionDetailView hash={HASH} />);
    expect(await screen.findByText("Failed")).toBeInTheDocument();
  });

  it("waits for transactions that have not landed yet", async () => {
    vi.spyOn(api.transactions, "status").mockRejectedValue(new ApiError("off", { status: 503, code: "SERVICE_UNAVAILABLE" }));
    vi.spyOn(api.transactions, "get").mockRejectedValue(new ApiError("missing", { status: 404, code: "TRANSACTION_NOT_FOUND" }));
    renderWithProviders(<TransactionDetailView hash={HASH} />);
    expect(await screen.findByText("Waiting for the network")).toBeInTheDocument();
  });

  it("rejects malformed hashes without fetching", () => {
    const get = vi.spyOn(api.transactions, "get");
    renderWithProviders(<TransactionDetailView hash="xyz" />);
    expect(screen.getByText("Invalid transaction hash")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("shows a failed submission reported by the status tracker", async () => {
    vi.spyOn(api.transactions, "get").mockRejectedValue(new ApiError("missing", { status: 404, code: "TRANSACTION_NOT_FOUND" }));
    vi.spyOn(api.transactions, "status").mockResolvedValue({
      hash: HASH,
      accountId: G,
      status: "failed",
      errorMessage: "tx_bad_seq",
      createdAt: "",
      updatedAt: "",
    });
    renderWithProviders(<TransactionDetailView hash={HASH} />);
    expect(await screen.findByText("Transaction failed")).toBeInTheDocument();
    expect(screen.getByText("tx_bad_seq")).toBeInTheDocument();
  });
});
