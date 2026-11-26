import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { THEME_STORAGE_KEY, ThemeProvider } from "@/components/theme/ThemeProvider";
import { AppearanceSettings } from "./AppearanceSettings";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("AppearanceSettings", () => {
  it("selects the stored theme and switches to another", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(
      <ThemeProvider>
        <AppearanceSettings />
      </ThemeProvider>,
    );
    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();

    await userEvent.setup().click(screen.getByRole("radio", { name: "Dark" }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
  });

  it("clears the stored choice when following the system", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(
      <ThemeProvider>
        <AppearanceSettings />
      </ThemeProvider>,
    );
    await userEvent.setup().click(screen.getByRole("radio", { name: "System" }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});
