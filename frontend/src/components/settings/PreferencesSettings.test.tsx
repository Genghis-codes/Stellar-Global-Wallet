import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import { renderWithProviders } from "@/test/render";
import { PreferencesSettings } from "./PreferencesSettings";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: "GABC" }) }));

beforeEach(() => vi.restoreAllMocks());

describe("PreferencesSettings", () => {
  it("shows stored values and saves a new currency", async () => {
    vi.spyOn(api.preferences, "get").mockResolvedValue({ currency: "USD", language: "en" });
    const update = vi.spyOn(api.preferences, "update").mockResolvedValue({ currency: "EUR", language: "en" });
    renderWithProviders(<PreferencesSettings />);

    const currency = await screen.findByRole("combobox", { name: "Display currency" });
    expect(currency).toHaveValue("USD");
    await userEvent.setup().selectOptions(currency, "EUR");

    expect(update).toHaveBeenCalledWith({ currency: "EUR" });
    expect(await screen.findByText("Preferences saved")).toBeInTheDocument();
    expect(currency).toHaveAccessibleDescription(/only quoted in USD/);
  });

  it("reports a failed save", async () => {
    vi.spyOn(api.preferences, "get").mockResolvedValue({});
    vi.spyOn(api.preferences, "update").mockRejectedValue(new ApiError("Invalid preferences payload", { status: 400, code: "VALIDATION_ERROR" }));
    renderWithProviders(<PreferencesSettings />);
    await userEvent.setup().selectOptions(await screen.findByRole("combobox", { name: "Display currency" }), "GBP");
    expect(await screen.findByText("Couldn't save preferences")).toBeInTheDocument();
  });
});
