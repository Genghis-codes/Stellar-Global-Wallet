import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

describe("Button", () => {
  it("defaults to type=button and fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Send</Button>);
    const button = screen.getByRole("button", { name: "Send" });
    expect(button).toHaveAttribute("type", "button");
    await userEvent.setup().click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("disables itself and marks busy while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick} rightIcon={<span>→</span>}>
        Signing
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Signing" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("→")).toBeNull();
    await userEvent.setup().click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
