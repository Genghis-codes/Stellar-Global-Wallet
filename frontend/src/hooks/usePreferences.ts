"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Preferences } from "@/lib/api/endpoints/preferences";
import { queryKeys } from "@/lib/query/keys";
import { useAuth } from "./useAuth";

/** The signed-in account's preferences ({} when none are stored yet). */
export function usePreferences() {
  const { account } = useAuth();
  return useQuery({
    queryKey: queryKeys.preferences.all(account ?? ""),
    queryFn: ({ signal }) => api.preferences.get(signal),
    enabled: Boolean(account),
    staleTime: 5 * 60_000,
  });
}

/**
 * Merge a patch into the stored preferences. The cache is updated
 * optimistically and rolled back if the server rejects the change.
 */
export function useUpdatePreferences() {
  const { account } = useAuth();
  const queryClient = useQueryClient();
  const key = queryKeys.preferences.all(account ?? "");

  return useMutation({
    mutationFn: (patch: Preferences) => api.preferences.update(patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Preferences>(key);
      queryClient.setQueryData<Preferences>(key, { ...previous, ...patch });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      // Restore the snapshot; with nothing to restore, refetch the server's copy
      // (setQueryData(undefined) is a no-op and would keep the rejected change).
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
      else void queryClient.invalidateQueries({ queryKey: key });
    },
    onSuccess: (preferences) => {
      queryClient.setQueryData(key, preferences);
    },
  });
}
