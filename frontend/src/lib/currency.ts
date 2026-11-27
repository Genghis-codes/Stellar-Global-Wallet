/**
 * Display currencies. The backend quotes every price in USD
 * (/api/v1/price answers `currency: "USD"`) and exposes no FX rates, so a
 * non-USD preference is stored but values are still shown in USD.
 */
export const DISPLAY_CURRENCIES = [
  { code: "USD", name: "US dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British pound" },
  { code: "NGN", name: "Nigerian naira" },
  { code: "KES", name: "Kenyan shilling" },
  { code: "BRL", name: "Brazilian real" },
  { code: "INR", name: "Indian rupee" },
] as const;

/** Currencies the app can actually convert into (only the quote currency). */
export const CONVERTIBLE_CURRENCIES: readonly string[] = ["USD"];

export const DEFAULT_CURRENCY = "USD";

/**
 * The currency fiat values are rendered in for a stored preference, and
 * whether that differs from what the user asked for.
 */
export function resolveDisplayCurrency(preference: string | undefined): { code: string; fallback: boolean } {
  const wanted = (preference ?? DEFAULT_CURRENCY).toUpperCase();
  if (CONVERTIBLE_CURRENCIES.includes(wanted)) return { code: wanted, fallback: false };
  return { code: DEFAULT_CURRENCY, fallback: true };
}
