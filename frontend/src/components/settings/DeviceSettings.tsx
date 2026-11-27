"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useDevices, useRevokeDevice } from "@/hooks/useDevices";
import type { Device } from "@/lib/api/endpoints/devices";
import { describeError } from "@/lib/api/errors";
import {
  currentPushEndpoint,
  defaultDeviceLabel,
  findCurrentDevice,
  readDeviceNames,
  writeDeviceName,
} from "@/lib/devices";
import { RenameDeviceModal } from "./RenameDeviceModal";

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Devices registered for push notifications, with this browser marked. */
export function DeviceSettings() {
  const devices = useDevices();
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [names, setNames] = useState(() => readDeviceNames());
  const [renaming, setRenaming] = useState<Device | null>(null);
  const [revoking, setRevoking] = useState<Device | null>(null);
  const revoke = useRevokeDevice();
  const toast = useToast();

  function confirmRevoke(device: Device) {
    revoke.mutate(device.id, {
      onSuccess: () => {
        setNames(writeDeviceName(device.id, ""));
        setRevoking(null);
        toast.show({
          tone: "success",
          title: "Device removed",
          description: "It will no longer receive notifications.",
        });
      },
      onError: (error) =>
        toast.show({ tone: "danger", title: "Couldn't remove the device", description: describeError(error) }),
    });
  }

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
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Rename ${names[device.id] ?? defaultDeviceLabel(device)}`}
                  onClick={() => setRenaming(device)}
                >
                  Rename
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Revoke ${names[device.id] ?? defaultDeviceLabel(device)}`}
                  onClick={() => setRevoking(device)}
                >
                  Revoke
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {renaming && (
        <RenameDeviceModal
          name={names[renaming.id] ?? defaultDeviceLabel(renaming)}
          onClose={() => setRenaming(null)}
          onSave={(name) => setNames(writeDeviceName(renaming.id, name === defaultDeviceLabel(renaming) ? "" : name))}
        />
      )}
      <Modal
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        title="Revoke this device?"
        description={
          revoking?.id === currentId
            ? "This browser will stop receiving notifications for this account."
            : "The device will stop receiving notifications for this account."
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={revoke.isPending} onClick={() => revoking && confirmRevoke(revoking)}>
              Revoke device
            </Button>
          </>
        }
      />
    </Card>
  );
}
