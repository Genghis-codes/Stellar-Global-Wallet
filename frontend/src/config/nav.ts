import type { ComponentType, SVGProps } from "react";
import { ActivityIcon, CoinsIcon, HomeIcon, KeyIcon, PenIcon, ShieldIcon, SettingsIcon } from "@/components/icons";

export interface NavItem {
  /** App route (inside the (app) route group). */
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Extra path prefixes that should highlight this item. */
  match?: string[];
}

/**
 * Primary navigation, rendered by the sidebar (desktop) and the drawer
 * (mobile). To add a page to the nav, create it under src/app/(app)/ and
 * append an entry here.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: HomeIcon },
  { href: "/activity", label: "Activity", icon: ActivityIcon },
  { href: "/assets", label: "Assets", icon: CoinsIcon },
  { href: "/security/signers", label: "Signers", icon: KeyIcon },
  { href: "/security/pending", label: "Pending", icon: PenIcon },
  { href: "/security/smart-wallet", label: "Smart wallet", icon: ShieldIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

/** Whether a nav item is the current section for `pathname`. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  const prefixes = [item.href, ...(item.match ?? [])];
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
