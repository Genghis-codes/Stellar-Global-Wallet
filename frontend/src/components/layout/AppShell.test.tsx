import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { AppShell } from "./AppShell";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

describe("AppShell", () => {
  it("offers a skip link as the first tab stop that targets the main region", async () => {
    render(
      <ThemeProvider>
        <AppShell>
          <p>Page body</p>
        </AppShell>
      </ThemeProvider>,
    );
    await userEvent.setup().tab();
    const skip = screen.getByRole("link", { name: "Skip to main content" });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute("href", "#main");
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main");
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(main).toHaveTextContent("Page body");
  });
});
