import type { ApiClient } from "../client";

/**
 * /api/v1/me/preferences — the signed-in account's preferences
 * (backend/src/routes/preferences.ts). PUT merges keys shallowly.
 */
export interface Preferences {
  currency?: string;
  language?: string;
  /** Asset ids hidden from the balance list. */
  hiddenAssets?: string[];
  notifications?: { email?: boolean; push?: boolean; payments?: boolean };
}

export function preferencesApi(client: ApiClient) {
  return {
    async get(signal?: AbortSignal): Promise<Preferences> {
      const { preferences } = await client.get<{ preferences: Preferences }>("/api/v1/me/preferences", { signal });
      return preferences;
    },

    async update(patch: Preferences): Promise<Preferences> {
      const { preferences } = await client.put<{ preferences: Preferences }>("/api/v1/me/preferences", patch);
      return preferences;
    },
  };
}

export type PreferencesApi = ReturnType<typeof preferencesApi>;
