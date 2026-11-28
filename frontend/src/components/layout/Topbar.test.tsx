import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Topbar } from "./Topbar";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

// Role queries over the full nav are slow in jsdom on a busy machine: skip
// userEvent's artificial delays and allow extra time rather than flake.
const TIMEOUT = 20_000;

function openDrawer() {
  const user = userEvent.setup({ delay: null });
  render(
    <ThemeProvider>
      <Topbar actions={<span>acct</span>} />
    </ThemeProvider>,
  );
  const trigger = screen.getByLabelText("Open navigation");
  return { user, trigger };
}

describe("Topbar", () => {
  it(
    "opens the drawer with focus on its close button and the current page marked",
    async () => {
      const { user, trigger } = openDrawer();
      expect(screen.getByText("acct")).toBeInTheDocument();
      await user.click(trigger);
      const drawer = screen.getByRole("dialog");
      expect(drawer).toHaveAccessibleName("Navigation");
      expect(within(drawer).getByLabelText("Close navigation")).toHaveFocus();
      expect(within(drawer).getByText("Dashboard").closest("a")).toHaveAttribute("aria-current", "page");
    },
    TIMEOUT,
  );

  it(
    "keeps Tab inside the drawer",
    async () => {
      const { user, trigger } = openDrawer();
      await user.click(trigger);
      const drawer = screen.getByRole("dialog");
      await user.tab({ shift: true });
      expect(drawer).toContainElement(document.activeElement as HTMLElement);
    },
    TIMEOUT,
  );

  it(
    "closes on Escape and returns focus to the trigger",
    async () => {
      const { user, trigger } = openDrawer();
      await user.click(trigger);
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(trigger).toHaveFocus();
    },
    TIMEOUT,
  );
});
