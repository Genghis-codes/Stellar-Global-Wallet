import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import { renderWithProviders } from "@/test/render";
import { EmailSettings, validateEmail } from "./EmailSettings";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: "GABC" }) }));

beforeEach(() => vi.restoreAllMocks());

describe("validateEmail", () => {
  it("rejects empty and malformed addresses", () => {
    expect(validateEmail(" ")).toBe("Enter an email address.");
    expect(validateEmail("nope")).toBe("Enter a valid email address.");
    expect(validateEmail(" a@b.co ")).toBeNull();
  });
});

describe("EmailSettings", () => {
  it("adds an address and asks for the code", async () => {
    vi.spyOn(api.email, "get").mockResolvedValue({ email: null, verified: false });
    const submit = vi.spyOn(api.email, "submit").mockResolvedValue({ message: "sent" });
    const user = userEvent.setup();
    renderWithProviders(<EmailSettings />);

    expect(await screen.findByText("No email address is verified yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(screen.getByRole("textbox", { name: "Email address" })).toHaveAccessibleDescription(
      "Enter an email address."
    );
    expect(submit).not.toHaveBeenCalled();

    await user.type(screen.getByRole("textbox", { name: "Email address" }), "me@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(submit).toHaveBeenCalledWith("me@example.com");
    expect(await screen.findByText("Verification email sent")).toBeInTheDocument();
  });

  it("shows the verified address and lets the user change it", async () => {
    vi.spyOn(api.email, "get").mockResolvedValue({ email: "old@example.com", verified: true });
    vi.spyOn(api.email, "submit").mockRejectedValue(
      new ApiError("already", { status: 409, code: "EMAIL_ALREADY_VERIFIED" })
    );
    const user = userEvent.setup();
    renderWithProviders(<EmailSettings />);

    expect(await screen.findByText("old@example.com")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change" }));
    await user.type(screen.getByRole("textbox", { name: "New email address" }), "old@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByText("This address is already verified.")).toBeInTheDocument();
  });
});
