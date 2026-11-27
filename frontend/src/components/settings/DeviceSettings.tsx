"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useDevices } from "@/hooks/useDevices";
import type { Device } from "@/lib/api/endpoints/devices";
import { describeError } from "@/lib/api/errors";
import { currentPushEndpoint, defaultDeviceLabel, findCurrentDevice, readDeviceNames } from "@/lib/devices";

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Devices registered for push notifications, with this browser marked. */
export function DeviceSettings() {
  const devices = useDevices();
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [names] = useState(() => readDeviceNames());

  useEffect(() => {
    let active = true;
    void currentPushEndpoint().then((value) => active && setEndpoint(value));
    return () => {
      active = false;
    };
  }, []);

  if (devices.isPending) {
    return <Skeleton className="h-48 rounded-[var(--radius-card)]" aria-label="Loading devices" />;
  }
  if (devices.isError) {
    return (
      <EmptyState
        title="Couldn't load your devices"
        description={describeError(devices.error)}
        action={<Button onClick={() => void devices.refetch()}>Try again</Button>}
      />
    );
  }

  const list = devices.data;
  const currentId = findCurrentDevice(list, endpoint);

  return (
    <Card>
      <CardHeader title="Devices" description="Phones and browsers that receive push notifications for this account." />
      {list.length === 0 ? (
        <p className="px-5 py-6 text-sm text-fg-muted">No devices are registered for notifications.</p>
      ) : (
        <ul className="divide-y divide-border px-5 pb-2 pt-3" aria-label="Registered devices">
          {list.map((device: Device) => (
            <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
                  {names[device.id] ?? defaultDeviceLabel(device)}
                  {device.id === currentId && <Badge tone="info">This device</Badge>}
                  {device.expires_at && new Date(device.expires_at) < new Date() && (
                    <Badge tone="warning">Expired</Badge>
                  )}
                </p>
                <p className="text-xs text-fg-muted">
                  {device.platform === "expo" ? "Mobile push" : "Web push"} · Added {formatDate(device.created_at)} ·
                  Last seen {formatDate(device.last_seen_at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
