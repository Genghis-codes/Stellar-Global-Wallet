import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import type { PriceHistory } from "@/lib/api/endpoints/price";
import { renderWithProviders } from "@/test/render";
import { PriceDetailModal } from "./PriceDetailModal";

const flags = { multisig: false, feeBump: false, pathPayments: false, recovery: false, priceOracle: true };

const history = (range: PriceHistory["range"], prices: (string | null)[]): PriceHistory => ({
  asset: "XLM",
  currency: "USD",
  range,
  resolution: "1h",
  intervalSeconds: 3600,
  source: "stellar_dex",
  from: "2026-06-01T00:00:00Z",
  to: "2026-06-02T00:00:00Z",
  points: prices.map((price, i) => ({ t: new Date(Date.UTC(2026, 5, 1, i)).toISOString(), price, filled: false })),
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api.config, "flags").mockResolvedValue(flags);
});

describe("PriceDetailModal", () => {
  it("shows the price, holding value, change and history by range", async () => {
    vi.spyOn(api.price, "many").mockResolvedValue([
      { asset: "XLM", price: "0.12", currency: "USD", source: "stellar_dex", updatedAt: new Date().toISOString() },
    ]);
    const historySpy = vi
      .spyOn(api.price, "history")
      .mockImplementation(async (_asset, range) =>
        range === "7d" ? history("7d", ["0.1", "0.12"]) : history("24h", ["0.12", "0.06"])
      );
    renderWithProviders(<PriceDetailModal asset="XLM" amount="100" onClose={vi.fn()} />);

    expect(await screen.findByText("$0.12", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("$12.00")).toBeInTheDocument();
    expect(await screen.findByText("+20.00%")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /XLM price, last 7 days/ })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "last 24 hours" }));
    expect(historySpy).toHaveBeenLastCalledWith("XLM", "24h", expect.anything());
    expect(await screen.findByText("−50.00%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "last 24 hours" })).toHaveAttribute("aria-pressed", "true");
  });

  it("handles missing prices and unavailable history", async () => {
    vi.spyOn(api.price, "many").mockResolvedValue([
      { asset: "XLM", price: null, currency: "USD", source: "unavailable", updatedAt: null },
    ]);
    vi.spyOn(api.price, "history").mockResolvedValue({ ...history("7d", []), source: "unavailable" });
    renderWithProviders(<PriceDetailModal asset="XLM" onClose={vi.fn()} />);
    expect(await screen.findByText("No price is available for XLM right now.")).toBeInTheDocument();
    expect(await screen.findByText("Price history isn't available for XLM.")).toBeInTheDocument();
  });

  it("flags stale prices", async () => {
    vi.spyOn(api.price, "many").mockResolvedValue([
      { asset: "XLM", price: "0.1", currency: "USD", source: "coingecko", updatedAt: "2020-01-01T00:00:00Z" },
    ]);
    vi.spyOn(api.price, "history").mockResolvedValue(history("7d", ["0.1", "0.1"]));
    renderWithProviders(<PriceDetailModal asset="XLM" onClose={vi.fn()} />);
    expect(await screen.findByText("May be out of date")).toBeInTheDocument();
  });
});
