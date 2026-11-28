import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoInput } from "./MemoInput";

// user-event flows are slow on loaded CI machines; the default 5 s is too tight.
vi.setConfig({ testTimeout: 20_000 });

describe("MemoInput", () => {
  it("counts UTF-8 bytes, not characters", () => {
    render(<MemoInput value="héllo😀" onChange={() => {}} />);
    expect(screen.getByLabelText("10 of 28 bytes")).toHaveTextContent("10/28");
  });

  it("marks the memo as required with a warning hint", () => {
    render(<MemoInput value="" onChange={() => {}} required />);
    expect(screen.getByLabelText("Memo (required)")).toBeInTheDocument();
    expect(screen.getByText(/may lose funds/)).toBeInTheDocument();
  });

  it("is read-only when a federation server set the memo", async () => {
    const onChange = vi.fn();
    render(<MemoInput value="42" onChange={onChange} required locked />);
    await userEvent.type(screen.getByLabelText("Memo (required)"), "x");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/federation server/)).toBeInTheDocument();
  });

  it("shows validation errors", () => {
    render(<MemoInput value={"a".repeat(30)} onChange={() => {}} error="Memo is 30 bytes" />);
    expect(screen.getByText("Memo is 30 bytes")).toBeInTheDocument();
    expect(screen.getByLabelText("Memo (optional)")).toHaveAttribute("aria-invalid", "true");
  });
});
