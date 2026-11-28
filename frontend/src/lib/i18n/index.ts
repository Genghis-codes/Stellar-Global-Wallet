import errorsEn from "@globe-wallet/i18n/errors/en.json";
import en from "./messages/en.json";
import { formatMessage, type MessageVars } from "./format";

/**
 * Web-app translations. Catalogues are flat JSON files keyed by dotted ids
 * with ICU-style placeholders, the same format as packages/i18n; API error
 * codes reuse that package's errors catalogue. Only English exists today:
 * add `messages/<locale>.json` and list it in CATALOGUES to add a language.
 */
export type MessageKey = keyof typeof en;
export type { MessageVars };

export const DEFAULT_LOCALE = "en";

const CATALOGUES: Record<string, Partial<Record<MessageKey, string>>> = { en };
const ERROR_CATALOGUES: Record<string, Record<string, string>> = { en: errorsEn };

export const SUPPORTED_LOCALES = Object.keys(CATALOGUES);

export const LANGUAGE_NAMES: Record<string, string> = { en: "English" };

/** Best supported locale for a preference and the browser's languages ("en-GB" → "en"). */
export function resolveLocale(...candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const tag = candidate.trim().toLowerCase();
    if (SUPPORTED_LOCALES.includes(tag)) return tag;
    const base = tag.split("-")[0]!;
    if (SUPPORTED_LOCALES.includes(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export type Translate = (key: MessageKey, vars?: MessageVars) => string;

/** A translator for `locale`, falling back to English and then to the key itself. */
export function createTranslator(locale: string): Translate {
  const catalogue = CATALOGUES[locale] ?? {};
  return (key, vars) => {
    const template = catalogue[key] ?? en[key] ?? key;
    return vars ? formatMessage(template, vars, locale) : template;
  };
}

/** User-facing text for a backend error code, or null when the catalogue has none. */
export function translateErrorCode(code: string, locale = DEFAULT_LOCALE, vars?: MessageVars): string | null {
  const template = ERROR_CATALOGUES[locale]?.[code] ?? errorsEn[code as keyof typeof errorsEn];
  if (template === undefined) return null;
  return vars ? formatMessage(template, vars, locale) : template;
}
