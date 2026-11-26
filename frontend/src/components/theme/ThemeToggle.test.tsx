import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { THEME_STORAGE_KEY, ThemeProvider } from "./ThemeProvider";
import { ThemeToggle } from "./ThemeToggle";

function mockMatchMedia(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: dark && query.includes("dark"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  document.documentElement.classList.remove("dark");
  vi.unstubAllGlobals();
});

describe("ThemeToggle", () => {
  it("follows the OS preference by default", () => {
    mockMatchMedia(true);
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
  });

  it("toggles and persists an explicit choice", async () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(document.documentElement).not.toHaveClass("dark");
    await userEvent.setup().click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("restores a stored choice over the OS setting", () => {
    mockMatchMedia(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(document.documentElement).not.toHaveClass("dark");
  });
});
