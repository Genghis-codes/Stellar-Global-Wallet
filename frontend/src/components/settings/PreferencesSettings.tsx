"use client";

import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { usePreferences, useUpdatePreferences } from "@/hooks/usePreferences";
import type { Preferences } from "@/lib/api/endpoints/preferences";
import { describeError } from "@/lib/api/errors";
import { NotificationSettings } from "./NotificationSettings";
import { useT } from "@/hooks/useT";
import { LANGUAGE_NAMES, SUPPORTED_LOCALES } from "@/lib/i18n";
import { DEFAULT_CURRENCY, DISPLAY_CURRENCIES, resolveDisplayCurrency } from "@/lib/currency";

/** Display currency and language, stored server-side in /me/preferences. */
export function PreferencesSettings() {
  const preferences = usePreferences();
  const update = useUpdatePreferences();
  const toast = useToast();
  const t = useT();

  function save(patch: Preferences) {
    update.mutate(patch, {
      onSuccess: () => toast.show({ id: "preferences-saved", tone: "success", title: t("preferences.saved") }),
      onError: (error) =>
        toast.show({
          id: "preferences-error",
          tone: "danger",
          title: t("preferences.saveFailed"),
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
        <CardHeader title={t("preferences.display.title")} description={t("preferences.display.description")} />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Select
            label={t("preferences.currency")}
            value={currency}
            onChange={(event) => save({ currency: event.target.value })}
            options={DISPLAY_CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}
            hint={fallback ? t("preferences.currency.fallback") : t("preferences.currency.hint")}
          />
          <Select
            label={t("preferences.language")}
            value={prefs.language ?? "en"}
            onChange={(event) => save({ language: event.target.value })}
            options={SUPPORTED_LOCALES.map((code) => ({ value: code, label: LANGUAGE_NAMES[code] ?? code }))}
          />
        </CardBody>
      </Card>
      <NotificationSettings />
    </div>
  );
}
