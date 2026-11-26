"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Device } from "@/lib/api/endpoints/devices";
import { queryKeys } from "@/lib/query/keys";
import { useAuth } from "./useAuth";

/** Push-notification devices registered for the signed-in account. */
export function useDevices() {
  const { account } = useAuth();
  return useQuery({
    queryKey: queryKeys.devices.all(account ?? ""),
    queryFn: ({ signal }) => api.devices.list(signal),
    enabled: Boolean(account),
  });
}

/** Revoke (unregister) a device and drop it from the cached list. */
export function useRevokeDevice() {
  const { account } = useAuth();
  const queryClient = useQueryClient();
  const key = queryKeys.devices.all(account ?? "");
  return useMutation({
    mutationFn: (id: string) => api.devices.remove(id),
    onSuccess: (_result, id) => {
      queryClient.setQueryData<Device[]>(key, (devices) => devices?.filter((device) => device.id !== id));
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
