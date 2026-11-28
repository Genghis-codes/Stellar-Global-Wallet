"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { useT } from "@/hooks/useT";
import type { Translate } from "@/lib/i18n";
import { AboutSettings } from "./AboutSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { DeviceSettings } from "./DeviceSettings";
import { EmailSettings } from "./EmailSettings";
import { NetworkSettings } from "./NetworkSettings";
import { PreferencesSettings } from "./PreferencesSettings";

/** Settings sections, in tab order. The selected one is kept in `?tab=`. */
function settingsTabs(t: Translate): TabItem[] {
  return [
    { id: "preferences", label: t("settings.tab.preferences"), content: <PreferencesSettings /> },
    { id: "email", label: t("settings.tab.email"), content: <EmailSettings /> },
    { id: "devices", label: t("settings.tab.devices"), content: <DeviceSettings /> },
    { id: "appearance", label: t("settings.tab.appearance"), content: <AppearanceSettings /> },
    { id: "network", label: t("settings.tab.network"), content: <NetworkSettings /> },
    { id: "about", label: t("settings.tab.about"), content: <AboutSettings /> },
  ];
}

export function SettingsView() {
  const router = useRouter();
  const pathname = usePathname() ?? "/settings";
  const searchParams = useSearchParams();
  const t = useT();
  const items = settingsTabs(t);
  const requested = searchParams?.get("tab");
  const value = items.some((item) => item.id === requested) ? requested! : items[0]!.id;

  function select(id: string) {
    const params = new URLSearchParams(searchParams?.toString());
    params.set("tab", id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <>
      <PageHeader title={t("settings.title")} description={t("settings.description")} />
      <Tabs items={items} value={value} onChange={select} aria-label={t("settings.sections")} />
    </>
  );
}
