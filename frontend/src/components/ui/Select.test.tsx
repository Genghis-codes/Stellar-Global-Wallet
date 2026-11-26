import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select } from "./Select";

describe("Select", () => {
  it("labels the control and reports changes", async () => {
    const onChange = vi.fn();
    render(
      <Select
        label="Currency"
        hint="Used for fiat values"
        value="USD"
        onChange={(event) => onChange(event.target.value)}
        options={[
          { value: "USD", label: "US dollar" },
          { value: "EUR", label: "Euro" },
        ]}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Currency" });
    expect(select).toHaveAccessibleDescription("Used for fiat values");
    await userEvent.setup().selectOptions(select, "EUR");
    expect(onChange).toHaveBeenCalledWith("EUR");
  });
});
