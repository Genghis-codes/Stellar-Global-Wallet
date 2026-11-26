import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "./Input";

describe("Input", () => {
  it("associates the label and hint", () => {
    render(<Input label="Destination" hint="A G... address or federation name" />);
    const input = screen.getByLabelText("Destination");
    expect(input).toHaveAccessibleDescription("A G... address or federation name");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("marks the field invalid and announces the error instead of the hint", () => {
    render(<Input label="Amount" hint="Max 7 decimals" error="Insufficient balance" trailing="XLM" />);
    const input = screen.getByLabelText("Amount");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Insufficient balance");
    expect(screen.queryByText("Max 7 decimals")).toBeNull();
    expect(screen.getByText("XLM")).toBeInTheDocument();
  });
});
