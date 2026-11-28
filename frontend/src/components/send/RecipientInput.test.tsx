import { useState } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { renderWithProviders } from "@/test/render";
import { RecipientInput } from "./RecipientInput";
import { useRecipient, type Recipient } from "./useRecipient";

// Slow on loaded CI machines; the default 5 s is too tight for user-event flows.
vi.setConfig({ testTimeout: 20_000 });

const G = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";

function Harness({ onRecipient }: { onRecipient: (recipient: Recipient | null) => void }) {
  const [value, setValue] = useState("");
  const state = useRecipient(value);
  onRecipient(state.recipient);
  return <RecipientInput value={value} onChange={setValue} state={state} />;
}

afterEach(() => vi.restoreAllMocks());

describe("RecipientInput + useRecipient", () => {
  it("accepts a G address without calling the backend", async () => {
    const resolve = vi.spyOn(api.resolve, "resolve");
    const onRecipient = vi.fn();
    renderWithProviders(<Harness onRecipient={onRecipient} />);

    await userEvent.click(screen.getByLabelText("Recipient"));
    await userEvent.paste(G);
    expect(onRecipient).toHaveBeenLastCalledWith({ kind: "account", destination: G, accountId: G });
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a validation error for malformed input", async () => {
    renderWithProviders(<Harness onRecipient={() => {}} />);
    await userEvent.click(screen.getByLabelText("Recipient"));
    await userEvent.paste("not-an-address");
    expect(screen.getByLabelText("Recipient")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/federation address \(name\*domain.com\)/)).toBeInTheDocument();
  });

  it("resolves a federation address and shows the account and memo", async () => {
    vi.spyOn(api.resolve, "resolve").mockResolvedValue({
      type: "federation",
      accountId: G,
      memo: "1234",
      memoType: "text",
    });
    const onRecipient = vi.fn();
    renderWithProviders(<Harness onRecipient={onRecipient} />);

    await userEvent.click(screen.getByLabelText("Recipient"));
    await userEvent.paste("bob*example.com");
    await waitFor(() =>
      expect(onRecipient).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: "federation", destination: G, memo: { type: "text", value: "1234" } }),
      ),
    );
    expect(api.resolve.resolve).toHaveBeenCalledWith("bob*example.com", expect.anything());
    expect(screen.getByText(/Resolves to/)).toBeInTheDocument();
    expect(screen.getByText(/with memo 1234/)).toBeInTheDocument();
  });

  it("reports federation failures", async () => {
    vi.spyOn(api.resolve, "resolve").mockRejectedValue(new Error("not found"));
    renderWithProviders(<Harness onRecipient={() => {}} />);
    await userEvent.click(screen.getByLabelText("Recipient"));
    await userEvent.paste("ghost*example.com");
    expect(await screen.findByText(/Couldn't resolve ghost\*example.com: not found/)).toBeInTheDocument();
  });
});
