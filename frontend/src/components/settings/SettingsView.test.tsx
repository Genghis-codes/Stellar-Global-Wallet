import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { renderWithProviders } from "@/test/render";
import { SettingsView } from "./SettingsView";

const replace = vi.fn();
let search = "";
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: "GABC" }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(search),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api.preferences, "get").mockResolvedValue({});
  replace.mockReset();
  search = "";
});

function renderView() {
  return renderWithProviders(
    <ThemeProvider>
      <SettingsView />
    </ThemeProvider>,
  );
}

describe("SettingsView", () => {
  it("opens the first tab by default and ignores unknown tabs", () => {
    search = "tab=nope";
    renderView();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Preferences" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the tab named in the URL", () => {
    search = "tab=appearance";
    renderView();
    expect(screen.getByRole("tab", { name: "Appearance" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the selected tab in the URL", async () => {
    renderView();
    await userEvent.setup().click(screen.getByRole("tab", { name: "Appearance" }));
    expect(replace).toHaveBeenCalledWith("/settings?tab=appearance", { scroll: false });
  });
});
