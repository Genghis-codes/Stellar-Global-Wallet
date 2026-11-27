import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/lib/api";
import type { Device } from "@/lib/api/endpoints/devices";
import { ApiError } from "@/lib/api/errors";
import { renderWithProviders } from "@/test/render";
import type * as DeviceLib from "@/lib/devices";
import { DeviceSettings } from "./DeviceSettings";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: "GABC" }) }));
vi.mock("@/lib/devices", async (importOriginal) => ({
  ...(await importOriginal<typeof DeviceLib>()),
  currentPushEndpoint: async () => "https://fcm.googleapis.com/fcm/send/me",
}));

const devices: Device[] = [
  {
    id: "1",
    account: "GABC",
    platform: "web",
    token: JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/me" }),
    locale: "en",
    created_at: "2026-01-01T00:00:00.000Z",
    last_seen_at: "2026-02-01T00:00:00.000Z",
    expires_at: null,
  },
  {
    id: "2",
    account: "GABC",
    platform: "expo",
    token: "ExponentPushToken[abc]",
    locale: "en",
    created_at: "2026-01-05T00:00:00.000Z",
    last_seen_at: "2026-01-06T00:00:00.000Z",
    expires_at: null,
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("DeviceSettings", () => {
  it("lists devices and marks this browser", async () => {
    vi.spyOn(api.devices, "list").mockResolvedValue(devices);
    renderWithProviders(<DeviceSettings />);
    const items = await screen.findAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Chrome browser");
    expect(await within(items[0]!).findByText("This device")).toBeInTheDocument();
    expect(items[1]).toHaveTextContent("Mobile app");
    expect(within(items[1]!).queryByText("This device")).toBeNull();
  });

  it("shows an empty state and a retryable error", async () => {
    vi.spyOn(api.devices, "list").mockResolvedValueOnce([]);
    const { unmount } = renderWithProviders(<DeviceSettings />);
    expect(await screen.findByText("No devices are registered for notifications.")).toBeInTheDocument();
    unmount();

    vi.spyOn(api.devices, "list").mockRejectedValue(
      new ApiError("Database unavailable", { status: 503, code: "INTERNAL_ERROR" })
    );
    renderWithProviders(<DeviceSettings />);
    expect(await screen.findByText("Couldn't load your devices")).toBeInTheDocument();
  });

  it("renames a device locally", async () => {
    vi.spyOn(api.devices, "list").mockResolvedValue(devices);
    const user = userEvent.setup();
    renderWithProviders(<DeviceSettings />);
    await user.click(await screen.findByRole("button", { name: "Rename Mobile app" }));
    const input = screen.getByRole("textbox", { name: "Device name" });
    await user.clear(input);
    await user.type(input, "My phone");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getAllByRole("listitem")[1]).toHaveTextContent("My phone");
    expect(JSON.parse(window.localStorage.getItem("gw.deviceNames")!)).toEqual({ "2": "My phone" });
  });
});
