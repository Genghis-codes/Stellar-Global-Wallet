"use client";

import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { usePreferences, useUpdatePreferences } from "@/hooks/usePreferences";
import type { Preferences } from "@/lib/api/endpoints/preferences";
import { describeError } from "@/lib/api/errors";

type NotificationKey = keyof NonNullable<Preferences["notifications"]>;

const TOGGLES: { key: NotificationKey; label: string; description: string }[] = [
  { key: "payments", label: "Payment alerts", description: "Tell me when I send or receive a payment." },
  { key: "email", label: "Email notifications", description: "Send alerts to my verified email address." },
  { key: "push", label: "Push notifications", description: "Send alerts to my registered devices." },
];

/** Notification channel toggles stored in /me/preferences (notifications.*). */
export function NotificationSettings() {
  const preferences = usePreferences();
  const update = useUpdatePreferences();
  const toast = useToast();
  const current = preferences.data?.notifications ?? {};

  function toggle(key: NotificationKey, value: boolean) {
    // PUT merges top-level keys only, so send the whole notifications object.
    update.mutate(
      { notifications: { ...current, [key]: value } },
      {
        onError: (error) =>
          toast.show({
            id: "notifications-error",
            tone: "danger",
            title: "Couldn't update notifications",
            description: describeError(error),
          }),
      }
    );
  }

  return (
    <Card>
      <CardHeader title="Notifications" description="Choose which alerts GlobeWallet sends you." />
      <CardBody className="flex flex-col gap-5">
        {TOGGLES.map((item) => (
          <Switch
            key={item.key}
            label={item.label}
            description={item.description}
            checked={current[item.key] ?? false}
            disabled={preferences.isPending}
            onChange={(value) => toggle(item.key, value)}
          />
        ))}
      </CardBody>
    </Card>
  );
}
