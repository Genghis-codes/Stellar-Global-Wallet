"use client";

import { useT } from "@/hooks/useT";

/** First focusable element on signed-in pages: jumps past the sidebar and top bar to #main. */
export function SkipLink() {
  const t = useT();
  return (
    <a
      href="#main"
      className="sr-only rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50"
    >
      {t("common.skipToContent")}
    </a>
  );
}
