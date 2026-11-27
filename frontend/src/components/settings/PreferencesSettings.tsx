"use client";

import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { usePreferences, useUpdatePreferences } from "@/hooks/usePreferences";
import type { Preferences } from "@/lib/api/endpoints/preferences";
import { describeError } from "@/lib/api/errors";
import { NotificationSettings } from "./NotificationSettings";
import { DEFAULT_CURRENCY, DISPLAY_CURRENCIES, resolveDisplayCurrency } from "@/lib/currency";

const LANGUAGES = [{ value: "en", label: "English" }];

/** Display currency and language, stored server-side in /me/preferences. */
export function PreferencesSettings() {
  const preferences = usePreferences();
  const update = useUpdatePreferences();
  const toast = useToast();

  function save(patch: Preferences) {
    update.mutate(patch, {
      onSuccess: () => toast.show({ id: "preferences-saved", tone: "success", title: "Preferences saved" }),
      onError: (error) =>
        toast.show({
          id: "preferences-error",
          tone: "danger",
          title: "Couldn't save preferences",
          description: describeError(error),
        }),
    });
  }

  if (preferences.isPending) {
    return <Skeleton className="h-48 rounded-[var(--radius-card)]" aria-label="Loading preferences" />;
  }

  const prefs = preferences.data ?? {};
  const currency = prefs.currency ?? DEFAULT_CURRENCY;
  const { fallback } = resolveDisplayCurrency(currency);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Display" description="Saved to your account and used on every device." />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Select
            label="Display currency"
            value={currency}
            onChange={(event) => save({ currency: event.target.value })}
            options={DISPLAY_CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}
            hint={
              fallback
                ? `Prices are only quoted in USD, so values are shown in USD for now.`
                : "Used for portfolio and asset values."
            }
          />
          <Select
            label="Language"
            value={prefs.language ?? "en"}
            onChange={(event) => save({ language: event.target.value })}
            options={LANGUAGES}
          />
        </CardBody>
      </Card>
      <NotificationSettings />
    </div>
  );
}
