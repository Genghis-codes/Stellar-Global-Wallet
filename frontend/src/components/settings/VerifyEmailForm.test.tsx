import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import { renderWithProviders } from "@/test/render";
import { EmailSettings } from "./EmailSettings";
import { VerifyEmailForm } from "./VerifyEmailForm";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: "GABC" }) }));

beforeEach(() => vi.restoreAllMocks());

describe("VerifyEmailForm", () => {
  it("requires a code and explains expired codes", async () => {
    const verify = vi
      .spyOn(api.email, "verify")
      .mockRejectedValue(new ApiError("expired", { status: 410, code: "EMAIL_TOKEN_EXPIRED" }));
    const user = userEvent.setup();
    renderWithProviders(<VerifyEmailForm email="me@example.com" onVerified={vi.fn()} onResend={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(screen.getByText("Enter the code from the email.")).toBeInTheDocument();
    expect(verify).not.toHaveBeenCalled();

    await user.type(screen.getByRole("textbox", { name: "Verification code" }), "abc");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText("This code has expired. Send a new one.")).toBeInTheDocument();
  });

  it("completes the add-and-verify flow", async () => {
    vi.spyOn(api.email, "get").mockResolvedValue({ email: null, verified: false });
    vi.spyOn(api.email, "submit").mockResolvedValue({ message: "sent" });
    vi.spyOn(api.email, "verify").mockResolvedValue({ message: "ok", email: "me@example.com" });
    const user = userEvent.setup();
    renderWithProviders(<EmailSettings />);

    await user.type(await screen.findByRole("textbox", { name: "Email address" }), "me@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await user.type(await screen.findByRole("textbox", { name: "Verification code" }), " tok-1 ");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(api.email.verify).toHaveBeenCalledWith("tok-1");
    expect(await screen.findByText("Email verified")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Verification code" })).toBeNull();
  });
});
