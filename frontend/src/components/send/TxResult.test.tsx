import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { WalletError } from "@/lib/wallet/types";
import { TxResult } from "./TxResult";
import { describeTxError } from "./txErrors";

const HASH = "a".repeat(64);

describe("TxResult", () => {
  it("shows success with an explorer link", async () => {
    const onDone = vi.fn();
    render(<TxResult status="success" hash={HASH} title="Payment sent" summary="10 XLM to bob" onDone={onDone} />);
    expect(screen.getByRole("status")).toHaveTextContent("Payment sent");
    expect(screen.getByRole("link", { name: /View on explorer/ })).toHaveAttribute("href", expect.stringContaining(`/tx/${HASH}`));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("explains a pending (timed-out) submission", () => {
    render(<TxResult status="pending" hash={HASH} />);
    expect(screen.getByText(/may still land/)).toBeInTheDocument();
  });

  it("announces failures and offers a retry", async () => {
    const onRetry = vi.fn();
    render(<TxResult status="failed" error="tx_insufficient_balance" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("tx_insufficient_balance");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("describeTxError", () => {
  it("is silent when the user declined in the wallet", () => {
    expect(describeTxError(new WalletError("USER_REJECTED", "declined"))).toBeNull();
  });

  it("describes wallet and API failures", () => {
    expect(describeTxError(new WalletError("NOT_INSTALLED", ""))).toMatch(/Freighter isn't available/);
    expect(describeTxError(new ApiError("Transaction expired", { status: 400, code: "TX_EXPIRED" }))).toBe("Transaction expired");
  });
});
