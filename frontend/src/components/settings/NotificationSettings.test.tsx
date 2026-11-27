import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import { renderWithProviders } from "@/test/render";
import { NotificationSettings } from "./NotificationSettings";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: "GABC" }) }));

beforeEach(() => vi.restoreAllMocks());

describe("NotificationSettings", () => {
  it("sends the full notifications object when one toggle changes", async () => {
    vi.spyOn(api.preferences, "get").mockResolvedValue({ notifications: { email: true } });
    const update = vi
      .spyOn(api.preferences, "update")
      .mockResolvedValue({ notifications: { email: true, payments: true } });
    renderWithProviders(<NotificationSettings />);

    const email = screen.getByRole("switch", { name: "Email notifications" });
    await waitFor(() => expect(email).toHaveAttribute("aria-checked", "true"));
    await userEvent.setup().click(screen.getByRole("switch", { name: "Payment alerts" }));

    expect(update).toHaveBeenCalledWith({ notifications: { email: true, payments: true } });
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Payment alerts" })).toHaveAttribute("aria-checked", "true")
    );
  });

  it("reverts the toggle when saving fails", async () => {
    vi.spyOn(api.preferences, "get").mockResolvedValue({});
    vi.spyOn(api.preferences, "update").mockRejectedValue(
      new ApiError("down", { status: 503, code: "INTERNAL_ERROR" })
    );
    renderWithProviders(<NotificationSettings />);
    const push = screen.getByRole("switch", { name: "Push notifications" });
    await waitFor(() => expect(push).toBeEnabled());
    await userEvent.setup().click(push);
    expect(await screen.findByText("Couldn't update notifications")).toBeInTheDocument();
    expect(push).toHaveAttribute("aria-checked", "false");
  });
});
