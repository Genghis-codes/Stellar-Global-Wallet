import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Topbar } from "./Topbar";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

describe("Topbar", () => {
  it("opens and closes the mobile navigation drawer", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Topbar actions={<span>acct</span>} />
      </ThemeProvider>,
    );
    expect(screen.getByText("acct")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    const drawer = screen.getByRole("dialog", { name: "Navigation" });
    expect(drawer).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull();
  });
});
