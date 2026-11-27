import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Countdown } from "./Countdown";

const NOW = Date.parse("2026-11-26T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("Countdown", () => {
  it("ticks down and shows the done label at zero", () => {
    render(<Countdown target={NOW + 2000} doneLabel="Ready" />);
    const time = screen.getByText("2s");
    expect(time).toHaveAttribute("aria-label", "2 seconds");
    expect(time).toHaveAttribute("datetime", new Date(NOW + 2000).toISOString());
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("1s")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("formats long waits", () => {
    render(<Countdown target={new Date(NOW + 26 * 3600_000).toISOString()} />);
    expect(screen.getByText("1d 2h")).toHaveAttribute("aria-label", "1 day, 2 hours");
  });
});
