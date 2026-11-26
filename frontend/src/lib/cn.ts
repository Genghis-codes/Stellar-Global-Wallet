/**
 * Join class names, skipping falsy values. Tiny on purpose: components pass
 * a base class string plus a few conditional ones and an optional override.
 */
export type ClassValue = string | false | null | undefined;

export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(" ");
}
