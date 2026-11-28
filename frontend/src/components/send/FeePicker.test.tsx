import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { NetworkFeesResponse } from "@/lib/api/endpoints/config";
import { FeePicker } from "./FeePicker";

const fees: NetworkFeesResponse = {
  low: { stroops: "100", xlm: "0.00001" },
  normal: { stroops: "250", xlm: "0.000025" },
  high: { stroops: "1000", xlm: "0.0001" },
  ledgerCapacityUsage: "0.5",
  source: "horizon",
};

describe("FeePicker", () => {
  it("lists the fee tiers and reports the chosen one", async () => {
    const onChange = vi.fn();
    render(<FeePicker fees={fees} value="normal" onChange={onChange} />);
    expect(screen.getByRole("radio", { name: /Normal/ })).toBeChecked();
    expect(screen.getByText("0.000025 XLM")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Fast/ }));
    expect(onChange).toHaveBeenCalledWith("high");
  });

  it("multiplies by the operation count and flags fallback data", () => {
    render(<FeePicker fees={{ ...fees, source: "fallback" }} value="low" onChange={() => {}} operations={3} />);
    expect(screen.getByText("0.00003 XLM")).toBeInTheDocument();
    expect(screen.getByText(/Live fee data is unavailable/)).toBeInTheDocument();
  });
});
