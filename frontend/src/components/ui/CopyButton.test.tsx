import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopyButton } from "./CopyButton";

afterEach(() => vi.restoreAllMocks());

describe("CopyButton", () => {
  it("writes the value to the clipboard and confirms", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const onCopied = vi.fn();
    render(<CopyButton value="GABC" label="Copy address" onCopied={onCopied} />);
    await user.click(screen.getByRole("button", { name: "Copy address" }));
    expect(writeText).toHaveBeenCalledWith("GABC");
    expect(onCopied).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("stays unchanged when the clipboard rejects", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    render(<CopyButton value="x" label="Copy" />);
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });
});
