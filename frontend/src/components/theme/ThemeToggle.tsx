"use client";

import { useSyncExternalStore } from "react";
import { useT } from "@/hooks/useT";
import { cn } from "@/lib/cn";
import { useTheme } from "./ThemeProvider";

const subscribe = () => () => {};

/** Button that flips between light and dark (an explicit choice overrides the OS setting). */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, setPreference } = useTheme();
  const t = useT();
  // The server cannot know the user's theme; render a neutral icon until hydrated.
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const isDark = hydrated && resolved === "dark";
  const label = isDark ? t("shell.themeToLight") : t("shell.themeToDark");

  return (
    <button
      type="button"
      onClick={() => setPreference(isDark ? "light" : "dark")}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-muted hover:text-fg",
        className,
      )}
    >
      {isDark ? (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  );
}
