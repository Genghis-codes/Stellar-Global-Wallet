import type { Device } from "@/lib/api/endpoints/devices";

/**
 * Helpers for the device list in Settings. The backend stores push tokens
 * only (no device names), so nicknames are kept in this browser's
 * localStorage, keyed by device id.
 */

export const DEVICE_NAMES_KEY = "gw.deviceNames";

/** The Web Push endpoint of a device, if its token is a serialised PushSubscription. */
export function webPushEndpoint(device: Pick<Device, "platform" | "token">): string | null {
  if (device.platform !== "web") return null;
  try {
    const parsed = JSON.parse(device.token) as { endpoint?: unknown };
    return typeof parsed.endpoint === "string" ? parsed.endpoint : null;
  } catch {
    return null;
  }
}

/** Default label when the user has not named a device. */
export function defaultDeviceLabel(device: Pick<Device, "platform" | "token">): string {
  if (device.platform === "expo") return "Mobile app";
  const endpoint = webPushEndpoint(device);
  if (!endpoint) return "Web browser";
  try {
    const host = new URL(endpoint).hostname;
    if (host.includes("googleapis") || host.includes("google")) return "Chrome browser";
    if (host.includes("mozilla")) return "Firefox browser";
    if (host.includes("apple")) return "Safari browser";
    if (host.includes("windows") || host.includes("microsoft")) return "Edge browser";
  } catch {
    // fall through
  }
  return "Web browser";
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function browserStorage(): Storage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

export function readDeviceNames(storage: Storage | undefined = browserStorage()): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(DEVICE_NAMES_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    );
  } catch {
    return {};
  }
}

/** Save (or clear, with an empty name) a nickname for a device. Names are capped at 40 characters. */
export function writeDeviceName(id: string, name: string, storage: Storage | undefined = browserStorage()) {
  const names = readDeviceNames(storage);
  const trimmed = name.trim().slice(0, 40);
  if (trimmed) names[id] = trimmed;
  else delete names[id];
  storage?.setItem(DEVICE_NAMES_KEY, JSON.stringify(names));
  return names;
}

/**
 * The Web Push endpoint this browser is subscribed with, or null when push
 * is unsupported or not set up. Used to mark "this device" in the list.
 */
export async function currentPushEndpoint(nav: Navigator | undefined = globalThis.navigator): Promise<string | null> {
  try {
    const registration = await nav?.serviceWorker?.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    return subscription?.endpoint ?? null;
  } catch {
    return null;
  }
}

/** Id of the listed device that is this browser, if any. */
export function findCurrentDevice(devices: Device[], endpoint: string | null): string | null {
  if (!endpoint) return null;
  return devices.find((device) => webPushEndpoint(device) === endpoint)?.id ?? null;
}
