"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { AboutSettings } from "./AboutSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { DeviceSettings } from "./DeviceSettings";
import { EmailSettings } from "./EmailSettings";
import { NetworkSettings } from "./NetworkSettings";
import { PreferencesSettings } from "./PreferencesSettings";

/** Settings sections, in tab order. The selected one is kept in `?tab=`. */
function settingsTabs(): TabItem[] {
  return [
    { id: "preferences", label: "Preferences", content: <PreferencesSettings /> },
    { id: "email", label: "Email", content: <EmailSettings /> },
    { id: "devices", label: "Devices", content: <DeviceSettings /> },
    { id: "appearance", label: "Appearance", content: <AppearanceSettings /> },
    { id: "network", label: "Network", content: <NetworkSettings /> },
    { id: "about", label: "About", content: <AboutSettings /> },
  ];
}

export function SettingsView() {
  const router = useRouter();
  const pathname = usePathname() ?? "/settings";
  const searchParams = useSearchParams();
  const items = settingsTabs();
  const requested = searchParams?.get("tab");
  const value = items.some((item) => item.id === requested) ? requested! : items[0]!.id;

  function select(id: string) {
    const params = new URLSearchParams(searchParams?.toString());
    params.set("tab", id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <>
      <PageHeader title="Settings" description="Preferences, security and app information." />
      <Tabs items={items} value={value} onChange={select} aria-label="Settings sections" />
    </>
  );
}
