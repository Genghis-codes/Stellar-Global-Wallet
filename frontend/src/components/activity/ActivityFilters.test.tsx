import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_FILTERS } from "@/lib/activity/filters";
import { ActivityFilters } from "./ActivityFilters";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

describe("ActivityFilters", () => {
  it("emits changes for each control", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ActivityFilters value={DEFAULT_FILTERS} onChange={onChange} assets={["XLM", `USDC:${ISSUER}`]} />);

    await user.selectOptions(screen.getByLabelText("Direction"), "in");
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, direction: "in" });

    await user.selectOptions(screen.getByLabelText("Asset"), `USDC:${ISSUER}`);
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, asset: `USDC:${ISSUER}` });
    expect(screen.getByRole("option", { name: "USDC (GA5Z…KZVN)" })).toBeInTheDocument();
  });

  it("clears only when something is filtered", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<ActivityFilters value={DEFAULT_FILTERS} onChange={onChange} assets={[]} />);
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeDisabled();
    rerender(<ActivityFilters value={{ ...DEFAULT_FILTERS, type: "payment" }} onChange={onChange} assets={[]} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onChange).toHaveBeenCalledWith(DEFAULT_FILTERS);
  });

  it("keeps a filtered asset selectable before it has loaded", () => {
    render(<ActivityFilters value={{ ...DEFAULT_FILTERS, asset: `EURC:${ISSUER}` }} onChange={vi.fn()} assets={["XLM"]} />);
    expect(screen.getByLabelText("Asset")).toHaveValue(`EURC:${ISSUER}`);
  });
});
