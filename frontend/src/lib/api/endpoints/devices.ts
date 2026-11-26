import type { ApiClient } from "../client";

/**
 * /api/v1/me/devices — push-notification devices registered for the
 * signed-in account (backend/src/routes/devices.ts). The backend lists,
 * registers (upserts by token) and deletes devices; it stores no device name.
 */
export type DevicePlatform = "expo" | "web";

/** Mirrors DeviceResponse in backend/src/services/deviceRegistry.ts. */
export interface Device {
  id: string;
  account: string;
  platform: DevicePlatform;
  /** Expo push token, or a JSON-serialised Web Push subscription. */
  token: string;
  locale: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string | null;
}

export interface RegisterDevice {
  platform: DevicePlatform;
  token: string;
  /** BCP-47 tag such as "en" or "en-US" (backend default "en"). */
  locale?: string;
}

export function devicesApi(client: ApiClient) {
  return {
    /** GET /api/v1/me/devices, newest first. */
    async list(signal?: AbortSignal): Promise<Device[]> {
      const { devices } = await client.get<{ devices: Device[] }>("/api/v1/me/devices", { signal });
      return devices;
    },

    /** POST /api/v1/me/devices (201). Re-registering the same token updates it. */
    async register(body: RegisterDevice): Promise<Device> {
      const { device } = await client.post<{ device: Device }>("/api/v1/me/devices", body);
      return device;
    },

    /** DELETE /api/v1/me/devices/:id (404 DEVICE_NOT_FOUND when unknown). */
    remove(id: string) {
      return client.delete<{ message: string }>(`/api/v1/me/devices/${encodeURIComponent(id)}`);
    },
  };
}

export type DevicesApi = ReturnType<typeof devicesApi>;
