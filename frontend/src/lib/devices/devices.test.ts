import { describe, expect, it } from "vitest";
import type { Device } from "@/lib/api/endpoints/devices";
import {
  DEVICE_NAMES_KEY,
  currentPushEndpoint,
  defaultDeviceLabel,
  findCurrentDevice,
  readDeviceNames,
  webPushEndpoint,
  writeDeviceName,
} from ".";

const web = (id: string, endpoint: string): Device => ({
  id,
  account: "G",
  platform: "web",
  token: JSON.stringify({ endpoint, keys: { p256dh: "x", auth: "y" } }),
  locale: "en",
  created_at: "",
  last_seen_at: "",
  expires_at: null,
});

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe("device helpers", () => {
  it("reads Web Push endpoints and labels devices", () => {
    const chrome = web("1", "https://fcm.googleapis.com/fcm/send/abc");
    expect(webPushEndpoint(chrome)).toBe("https://fcm.googleapis.com/fcm/send/abc");
    expect(defaultDeviceLabel(chrome)).toBe("Chrome browser");
    expect(defaultDeviceLabel(web("2", "https://updates.push.services.mozilla.com/x"))).toBe("Firefox browser");
    expect(defaultDeviceLabel({ platform: "expo", token: "ExponentPushToken[x]" })).toBe("Mobile app");
    expect(defaultDeviceLabel({ platform: "web", token: "not json" })).toBe("Web browser");
  });

  it("stores, trims and clears nicknames", () => {
    const storage = memoryStorage();
    expect(writeDeviceName("1", "  Work laptop  ", storage)).toEqual({ "1": "Work laptop" });
    expect(readDeviceNames(storage)).toEqual({ "1": "Work laptop" });
    expect(writeDeviceName("1", "", storage)).toEqual({});
    storage.setItem(DEVICE_NAMES_KEY, "[1,2]");
    expect(readDeviceNames(storage)).toEqual({});
  });

  it("finds this browser's device by push endpoint", async () => {
    const devices = [web("1", "https://a.example/1"), web("2", "https://a.example/2")];
    expect(findCurrentDevice(devices, "https://a.example/2")).toBe("2");
    expect(findCurrentDevice(devices, null)).toBeNull();

    const nav = {
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: { getSubscription: async () => ({ endpoint: "https://a.example/1" }) },
        }),
      },
    } as unknown as Navigator;
    await expect(currentPushEndpoint(nav)).resolves.toBe("https://a.example/1");
    await expect(currentPushEndpoint({} as Navigator)).resolves.toBeNull();
  });
});
