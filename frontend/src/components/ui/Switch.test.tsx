import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "./Switch";

describe("Switch", () => {
  it("is labelled, reports its state and toggles", async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Email alerts" description="Sent to your inbox" />);
    const toggle = screen.getByRole("switch", { name: "Email alerts" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleDescription("Sent to your inbox");
    await userEvent.setup().click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does nothing when disabled", async () => {
    const onChange = vi.fn();
    render(<Switch checked onChange={onChange} label="Push" disabled />);
    await userEvent.setup().click(screen.getByRole("switch", { name: "Push" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
