import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorFallback } from "./ErrorFallback";

describe("ErrorFallback", () => {
  it("shows the digest and retries", async () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("boom"), { digest: "abc123" });
    render(<ErrorFallback error={error} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Reference: abc123");
    expect(screen.queryByText("boom")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
