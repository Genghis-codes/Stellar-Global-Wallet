"use client";

import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { useToast } from "@/components/ui/Toast";
import { usePreferences, useUpdatePreferences } from "@/hooks/usePreferences";
import { useT } from "@/hooks/useT";
import type { Preferences } from "@/lib/api/endpoints/preferences";
import { describeError } from "@/lib/api/errors";

type NotificationKey = keyof NonNullable<Preferences["notifications"]>;

const TOGGLES = ["payments", "email", "push"] as const satisfies readonly NotificationKey[];

/** Notification channel toggles stored in /me/preferences (notifications.*). */
export function NotificationSettings() {
  const preferences = usePreferences();
  const update = useUpdatePreferences();
  const toast = useToast();
  const t = useT();
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
            title: t("notifications.saveFailed"),
            description: describeError(error),
          }),
      }
    );
  }

  return (
    <Card>
      <CardHeader title={t("notifications.title")} description={t("notifications.description")} />
      <CardBody className="flex flex-col gap-5">
        {TOGGLES.map((key) => (
          <Switch
            key={key}
            label={t(`notifications.${key}`)}
            description={t(`notifications.${key}.description`)}
            checked={current[key] ?? false}
            disabled={preferences.isPending}
            onChange={(value) => toggle(key, value)}
          />
        ))}
      </CardBody>
    </Card>
  );
}
