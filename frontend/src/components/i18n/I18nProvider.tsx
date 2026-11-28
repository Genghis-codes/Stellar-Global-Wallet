"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import { createTranslator, DEFAULT_LOCALE, resolveLocale, type Translate } from "@/lib/i18n";

export interface I18nContextValue {
  locale: string;
  t: Translate;
}

// Outside a provider (unit tests, error boundaries) components still get English.
const I18nContext = createContext<I18nContextValue>({ locale: DEFAULT_LOCALE, t: createTranslator(DEFAULT_LOCALE) });

/**
 * Picks the UI language: the signed-in account's `language` preference,
 * else the browser's languages, else English. Keeps <html lang> in sync.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const preferences = usePreferences();
  const browser = typeof navigator === "undefined" ? undefined : navigator.language;
  const locale = resolveLocale(preferences.data?.language, browser);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(() => ({ locale, t: createTranslator(locale) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
