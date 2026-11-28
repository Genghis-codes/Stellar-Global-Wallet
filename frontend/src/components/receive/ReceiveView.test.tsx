import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import { renderWithProviders } from "@/test/render";
import { ReceiveView } from "./ReceiveView";

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: G }) }));

afterEach(() => vi.restoreAllMocks());

describe("ReceiveView", () => {
  it("shows the address as QR and text with a copy button", async () => {
    vi.spyOn(api.account, "reserves").mockResolvedValue({
      reserves: {
        baseReserve: "0.5",
        subentryCount: 0,
        numSponsoring: 0,
        numSponsored: 0,
        minimumBalance: "1",
        sellingLiabilities: "0",
        spendable: "9",
      },
      balances: [{ asset_type: "native", balance: "10", spendable: "9" }],
    });
    renderWithProviders(<ReceiveView />);

    expect(screen.getByRole("img", { name: "Your Stellar address as a QR code" })).toBeInTheDocument();
    expect(screen.getByText(G)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy address" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Create payment request" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Generate muxed address" })).toBeInTheDocument();
  });

  it("explains how an unfunded account gets created", async () => {
    vi.spyOn(api.account, "reserves").mockRejectedValue(new ApiError("not found", { status: 404, code: "ACCOUNT_NOT_FOUND" }));
    renderWithProviders(<ReceiveView />);
    expect(await screen.findByText(/first payment must be at least 1 XLM/)).toBeInTheDocument();
  });
});
