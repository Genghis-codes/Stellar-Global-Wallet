"use client";

import { useSyncExternalStore } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { useTheme, type ThemePreference } from "@/components/theme/ThemeProvider";
import { cn } from "@/lib/cn";

const OPTIONS: { value: ThemePreference; label: string; description: string }[] = [
  { value: "system", label: "System", description: "Follow your device setting" },
  { value: "light", label: "Light", description: "Always use the light theme" },
  { value: "dark", label: "Dark", description: "Always use the dark theme" },
];

const subscribe = () => () => {};

/** Theme choice: light, dark or follow the operating system. */
export function AppearanceSettings() {
  const { preference, setPreference } = useTheme();
  // The stored preference is only known in the browser.
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const current = hydrated ? preference : undefined;

  return (
    <Card>
      <CardHeader title="Theme" description="Choose how GlobeWallet looks on this device." />
      <CardBody>
        <fieldset>
          <legend className="sr-only">Theme</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {OPTIONS.map((option) => (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer flex-col gap-1 rounded-lg border p-4 focus-within:ring-2 focus-within:ring-ring",
                  current === option.value ? "border-primary bg-primary/5" : "border-border hover:bg-surface-muted",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-fg">
                  <input
                    type="radio"
                    name="theme"
                    value={option.value}
                    checked={current === option.value}
                    onChange={() => setPreference(option.value)}
                    aria-label={option.label}
                    aria-describedby={`theme-${option.value}-description`}
                    className="accent-primary"
                  />
                  {option.label}
                </span>
                <span id={`theme-${option.value}-description`} className="text-xs text-fg-muted">
                  {option.description}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </CardBody>
    </Card>
  );
}
