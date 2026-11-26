import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(<Modal open={false} onClose={() => {}} title="Hidden" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is labelled by its title and description", () => {
    render(<Modal open onClose={() => {}} title="Confirm send" description="Check the details" />);
    const dialog = screen.getByRole("dialog", { name: "Confirm send" });
    expect(dialog).toHaveAccessibleDescription("Check the details");
  });

  it("closes on Escape and backdrop click", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Modal open onClose={onClose} title="Dialog" />);
    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("ignores Escape when not dismissible", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Modal open onClose={onClose} title="Signing" dismissible={false} />);
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Close dialog")).toBeNull();
  });

  it("traps focus inside the dialog", async () => {
    const user = userEvent.setup();
    render(
      <Modal open onClose={() => {}} title="Trap" footer={<button type="button">Confirm</button>}>
        <input aria-label="Amount" />
      </Modal>,
    );
    const close = screen.getByLabelText("Close dialog");
    expect(close).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("Amount")).toHaveFocus();
    await user.tab();
    expect(screen.getByText("Confirm")).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
  });
});
