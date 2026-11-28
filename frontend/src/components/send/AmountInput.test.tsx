import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AmountInput } from "./AmountInput";

// user-event flows are slow on loaded CI machines; the default 5 s is too tight.
vi.setConfig({ testTimeout: 20_000 });

function Harness(props: { max: string; reserve?: string }) {
  const [value, setValue] = useState("");
  return <AmountInput value={value} onChange={setValue} assetCode="XLM" {...props} />;
}

describe("AmountInput", () => {
  it("shows what is available and the reserve held back", () => {
    render(<Harness max="98.49999" reserve="1.50001" />);
    expect(screen.getByText(/Available: 98\.49999 XLM/)).toBeInTheDocument();
    expect(screen.getByText(/1\.50001 XLM is held as the account reserve/)).toBeInTheDocument();
  });

  it("fills the maximum and normalises typed input", async () => {
    render(<Harness max="98.49999" />);
    const input = screen.getByLabelText("Amount");
    await userEvent.type(input, "1,5x");
    expect(input).toHaveValue("1.5");
    await userEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(input).toHaveValue("98.49999");
  });

  it("disables Max when nothing is available", () => {
    render(<Harness max="0" />);
    expect(screen.getByRole("button", { name: "Max" })).toBeDisabled();
  });
});
