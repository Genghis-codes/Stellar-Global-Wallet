import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import { renderWithProviders } from "@/test/render";
import { FeeBumpAction } from "./FeeBumpAction";

// Slow on loaded CI machines; the default 5 s is too tight for user-event flows.
vi.setConfig({ testTimeout: 20_000 });

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const signTransaction = vi.fn();
const buildFeeBump = vi.fn(() => "BUMP");

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G, wallet: { signTransaction } }) }));
vi.mock("@/lib/stellar/feeBump", () => ({
  feePerOperation: () => 100n,
  feeBumpTotal: (_xdr: string, _passphrase: string, perOp: bigint) => perOp * 2n,
  buildFeeBump: (...args: unknown[]) => buildFeeBump(...(args as [])),
}));

beforeEach(() => {
  vi.spyOn(api.config, "flags").mockResolvedValue({ multisig: true, feeBump: true, pathPayments: true, recovery: false, priceOracle: false });
  vi.spyOn(api.config, "fees").mockResolvedValue({
    low: { stroops: "100", xlm: "0.00001" },
    normal: { stroops: "100", xlm: "0.00001" },
    high: { stroops: "500", xlm: "0.00005" },
    ledgerCapacityUsage: "0.9",
    source: "horizon",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  signTransaction.mockReset();
  buildFeeBump.mockClear();
});

describe("FeeBumpAction", () => {
  it("wraps the signed transaction in a fee bump paid by the user", async () => {
    signTransaction.mockResolvedValue("SIGNED_BUMP");
    const submit = vi.spyOn(api.wallet, "submit").mockResolvedValue({ hash: "h2", successful: true });
    const onSubmitted = vi.fn();
    renderWithProviders(<FeeBumpAction signedXdr="SIGNED" networkPassphrase="pp" onSubmitted={onSubmitted} />);

    await userEvent.click(await screen.findByRole("button", { name: "Speed up (0.0001 XLM)" }, { timeout: 10_000 }));

    expect(buildFeeBump).toHaveBeenCalledWith("SIGNED", G, 500n, "pp");
    expect(submit).toHaveBeenCalledWith("SIGNED_BUMP", { account: G, idempotencyKey: expect.any(String) });
    expect(onSubmitted).toHaveBeenCalledWith({ hash: "h2", successful: true });
  });

  it("asks the server's fee sponsor and hides the option when none is configured", async () => {
    const sponsor = vi
      .spyOn(api.wallet, "sponsorFee")
      .mockRejectedValue(new ApiError("not configured", { status: 503, code: "FEE_SPONSOR_NOT_CONFIGURED" }));
    renderWithProviders(<FeeBumpAction signedXdr="SIGNED" networkPassphrase="pp" onSubmitted={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Let GlobeWallet pay the fee" }));

    expect(sponsor).toHaveBeenCalledWith(G, "SIGNED");
    expect(await screen.findByText(/Fee sponsorship isn't available/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Let GlobeWallet pay the fee" })).not.toBeInTheDocument();
  });

  it("is hidden when the server turned fee bumps off", async () => {
    vi.spyOn(api.config, "flags").mockResolvedValue({ multisig: true, feeBump: false, pathPayments: true, recovery: false, priceOracle: false });
    renderWithProviders(<FeeBumpAction signedXdr="SIGNED" networkPassphrase="pp" onSubmitted={() => {}} />);
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: /Speed up/ })).not.toBeInTheDocument());
  });
});
