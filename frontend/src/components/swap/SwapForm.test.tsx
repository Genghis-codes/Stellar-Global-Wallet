import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AssetOption } from "@/components/send/AssetPicker";
import { api } from "@/lib/api";
import type { PaymentPath } from "@/lib/api/endpoints/wallet";
import { renderWithProviders } from "@/test/render";
import { SwapForm } from "./SwapForm";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC = `USDC:${ISSUER}`;

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G }) }));
vi.mock("@/hooks/useDebouncedValue", () => ({ useDebouncedValue: <T,>(value: T) => value }));

const options: AssetOption[] = [
  { id: "XLM", asset: { code: "XLM" }, balance: "100", spendable: "98" },
  { id: USDC, asset: { code: "USDC", issuer: ISSUER }, balance: "20", spendable: "20" },
];

const quote = (source: string, destination: string): PaymentPath => ({
  source_asset_type: "native",
  source_amount: source,
  destination_asset_type: "credit_alphanum4",
  destination_asset_code: "USDC",
  destination_asset_issuer: ISSUER,
  destination_amount: destination,
  path: [],
});

afterEach(() => vi.restoreAllMocks());

describe("SwapForm", () => {
  it("quotes an exact-input swap and hands the draft to review", async () => {
    vi.spyOn(api.wallet, "strictSendPaths").mockResolvedValue([quote("10", "1.2")]);
    const onReview = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<SwapForm options={options} onReview={onReview} />);

    await user.type(screen.getByLabelText("Amount to pay"), "10");
    expect(await screen.findByText("Minimum received")).toBeInTheDocument();
    expect(screen.getByText(/You receive about/)).toHaveTextContent("1.2 USDC");
    await user.click(screen.getByRole("button", { name: "Review swap" }));
    expect(onReview).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "send", amount: "10", slippageBps: 50, quote: quote("10", "1.2") }),
    );
    expect(onReview.mock.calls[0]![0].from.id).toBe("XLM");
    expect(onReview.mock.calls[0]![0].to.id).toBe(USDC);
  });

  it("blocks amounts above the spendable balance", async () => {
    const spy = vi.spyOn(api.wallet, "strictSendPaths").mockResolvedValue([quote("99", "12")]);
    const user = userEvent.setup();
    renderWithProviders(<SwapForm options={options} onReview={() => {}} />);
    await user.type(screen.getByLabelText("Amount to pay"), "99");
    expect(screen.getByText("You can swap at most 98 XLM.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review swap" })).toBeDisabled();
    expect(spy).toHaveBeenCalled();
  });

  it("says when no route exists", async () => {
    vi.spyOn(api.wallet, "strictSendPaths").mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithProviders(<SwapForm options={options} onReview={() => {}} />);
    await user.type(screen.getByLabelText("Amount to pay"), "5");
    expect(await screen.findByText(/No route found from XLM to USDC/)).toBeInTheDocument();
  });

  it("quotes exact-output swaps and flips assets", async () => {
    const spy = vi.spyOn(api.wallet, "strictReceivePaths").mockResolvedValue([quote("9", "1")]);
    const user = userEvent.setup();
    renderWithProviders(<SwapForm options={options} onReview={() => {}} />);
    await user.click(screen.getByRole("radio", { name: "Exact amount to receive" }));
    await user.type(screen.getByLabelText("Amount to receive"), "1");
    expect(await screen.findByText("Maximum spent")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(G, { destinationAmount: "1", destinationAsset: USDC, sourceAsset: "XLM" }, expect.anything());

    await user.click(screen.getByRole("button", { name: "Switch assets" }));
    expect(screen.getByLabelText("You pay")).toHaveValue(USDC);
    expect(screen.getByLabelText("You receive")).toHaveValue("XLM");
  });
});
