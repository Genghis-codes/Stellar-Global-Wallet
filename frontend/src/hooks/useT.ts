"use client";

import { useI18n } from "@/components/i18n/I18nProvider";
import type { Translate } from "@/lib/i18n";

/** The translate function for the current UI language. */
export function useT(): Translate {
  return useI18n().t;
}

export { useI18n };
