import { describe, expect, it } from "vitest";
import { callHeaders, errorResponse, jsonResponse, mockFetch } from "@/test/fetch";
import { createApiClient } from "../client";
import { isApiError } from "../errors";
import { MemoryTokenStore } from "../tokens";
import { devicesApi, type Device } from "./devices";

const device: Device = {
  id: "7",
  account: "GABC",
  platform: "web",
  token: '{"endpoint":"https://push.example/1"}',
  locale: "en",
  created_at: "2026-01-01T00:00:00.000Z",
  last_seen_at: "2026-01-02T00:00:00.000Z",
  expires_at: null,
};

function setup(...responses: Response[]) {
  const tokens = new MemoryTokenStore();
  tokens.set({ accessToken: "acc", refreshToken: "ref" });
  const fetch = mockFetch(...responses);
  return { fetch, devices: devicesApi(createApiClient({ baseUrl: "http://api.test", fetch, tokens })) };
}

describe("devicesApi", () => {
  it("lists devices and unwraps the envelope", async () => {
    const { fetch, devices } = setup(jsonResponse({ devices: [device] }));
    await expect(devices.list()).resolves.toEqual([device]);
    expect(fetch.mock.calls[0]![0]).toBe("http://api.test/api/v1/me/devices");
    expect(callHeaders(fetch).Authorization).toBe("Bearer acc");
  });

  it("registers a device", async () => {
    const { fetch, devices } = setup(jsonResponse({ device }, { status: 201 }));
    await expect(devices.register({ platform: "web", token: device.token, locale: "en" })).resolves.toEqual(device);
    const init = fetch.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ platform: "web", token: device.token, locale: "en" });
  });

  it("removes a device by id and reports unknown ids", async () => {
    const { fetch, devices } = setup(
      jsonResponse({ message: "Device removed" }),
      errorResponse(404, "DEVICE_NOT_FOUND"),
    );
    await expect(devices.remove("7")).resolves.toEqual({ message: "Device removed" });
    expect(fetch.mock.calls[0]![0]).toBe("http://api.test/api/v1/me/devices/7");
    expect(fetch.mock.calls[0]![1]!.method).toBe("DELETE");
    const error = await devices.remove("8").catch((e: unknown) => e);
    expect(isApiError(error) && error.code).toBe("DEVICE_NOT_FOUND");
  });
});
