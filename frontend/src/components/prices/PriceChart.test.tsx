import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PriceChart } from "./PriceChart";

const points = [
  { t: Date.parse("2026-06-01T00:00:00Z"), value: 0.1 },
  { t: Date.parse("2026-06-02T00:00:00Z"), value: 0.12 },
  { t: Date.parse("2026-06-03T00:00:00Z"), value: null },
  { t: Date.parse("2026-06-04T00:00:00Z"), value: 0.11 },
];

describe("PriceChart", () => {
  it("is a labelled image with a data table", () => {
    render(<PriceChart points={points} label="XLM price, last 7 days" />);
    expect(screen.getByRole("img")).toHaveAccessibleName("XLM price, last 7 days. Low $0.10, high $0.12.");
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });

  it("shows a tooltip while navigating with the keyboard", () => {
    render(<PriceChart points={points} label="XLM" />);
    const chart = screen.getByRole("img");
    fireEvent.keyDown(chart, { key: "Home" });
    expect(screen.getByRole("status")).toHaveTextContent("$0.10");
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByRole("status")).toHaveTextContent("$0.12");
    fireEvent.blur(chart);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("explains when there is too little data", () => {
    render(<PriceChart points={[{ t: 0, value: 1 }]} label="XLM" />);
    expect(screen.getByText("Not enough price data to draw a chart.")).toBeInTheDocument();
  });
});
