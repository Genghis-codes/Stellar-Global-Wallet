import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { api } from "@/lib/api";
import { useT } from "@/hooks/useT";
import { renderWithProviders } from "@/test/render";
import { I18nProvider, useI18n } from "./I18nProvider";

let account: string | null = "GABC";
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account }) }));

function Probe() {
  const t = useT();
  const { locale } = useI18n();
  return (
    <p>
      {locale}:{t("nav.settings")}
    </p>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  account = "GABC";
});

describe("I18nProvider", () => {
  it("uses the account's language preference and sets <html lang>", async () => {
    vi.spyOn(api.preferences, "get").mockResolvedValue({ language: "en" });
    renderWithProviders(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );
    expect(screen.getByText("en:Settings")).toBeInTheDocument();
    await waitFor(() => expect(api.preferences.get).toHaveBeenCalled());
    expect(document.documentElement.lang).toBe("en");
  });

  it("falls back to English when signed out and outside a provider", () => {
    account = null;
    const get = vi.spyOn(api.preferences, "get");
    renderWithProviders(<Probe />);
    expect(screen.getByText("en:Settings")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});
