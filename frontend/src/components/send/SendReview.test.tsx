import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SendReview, type SendReviewProps } from "./SendReview";

// Slow on loaded CI machines; the default 5 s is too tight for user-event flows.
vi.setConfig({ testTimeout: 20_000 });

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

function setup(overrides: Partial<SendReviewProps> = {}) {
  const props: SendReviewProps = {
    recipient: { kind: "federation", destination: G, accountId: G, federationAddress: "bob*example.com" },
    amount: "12.5",
    assetCode: "XLM",
    memo: "rent",
    feeXlm: "0.00001",
    warnings: [],
    blocking: false,
    onConfirm: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
  render(<SendReview {...props} />);
  return props;
}

describe("SendReview", () => {
  it("summarises the payment and confirms", async () => {
    const props = setup({ createsAccount: true });
    expect(screen.getByText("bob*example.com")).toBeInTheDocument();
    expect(screen.getByText("New account")).toBeInTheDocument();
    expect(screen.getByText("rent")).toBeInTheDocument();
    expect(screen.getByText(/0\.00001 XLM/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign and send" }));
    expect(props.onConfirm).toHaveBeenCalled();
  });

  it("blocks signing when a precheck warning is blocking", () => {
    setup({
      blocking: true,
      warnings: [{ code: "MEMO_REQUIRED", message: "Destination requires a memo.", blocking: true }],
    });
    expect(screen.getByRole("button", { name: "Sign and send" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Destination requires a memo.");
  });

  it("explains the second approval for a fee bump and waits for the wallet", async () => {
    const props = setup({ feeBump: true, signing: true });
    expect(screen.getByText(/two wallet approvals/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Waiting for wallet/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(props.onBack).not.toHaveBeenCalled();
  });
});
