import type { ComponentType, SVGProps } from "react";
import type { MessageKey } from "@/lib/i18n";
import { ActivityIcon, CoinsIcon, GiftIcon, HomeIcon, KeyIcon, PenIcon, ReceiveIcon, SendIcon, ShieldIcon, SettingsIcon } from "@/components/icons";

export interface NavItem {
  /** App route (inside the (app) route group). */
  href: string;
  label: string;
  /** Translation key for the label (falls back to `label`). */
  labelKey?: MessageKey;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Extra path prefixes that should highlight this item. */
  match?: string[];
  /** Translation key of the group heading shown above the first item of a group. */
  sectionKey?: MessageKey;
}

/**
 * Primary navigation, rendered by the sidebar (desktop) and the drawer
 * (mobile). To add a page to the nav, create it under src/app/(app)/ and
 * append an entry here.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", labelKey: "nav.dashboard", icon: HomeIcon },
  { href: "/send", label: "Send", labelKey: "nav.send", icon: SendIcon },
  { href: "/receive", label: "Receive", labelKey: "nav.receive", icon: ReceiveIcon, match: ["/pay"] },
  { href: "/activity", label: "Activity", labelKey: "nav.activity", icon: ActivityIcon },
  { href: "/assets", label: "Assets", labelKey: "nav.assets", icon: CoinsIcon },
  { href: "/claimable", label: "Claimable", labelKey: "nav.claimable", icon: GiftIcon },
  { href: "/security/signers", label: "Signers", labelKey: "nav.signers", icon: KeyIcon, sectionKey: "nav.section.security" },
  { href: "/security/pending", label: "Pending", labelKey: "nav.pending", icon: PenIcon, sectionKey: "nav.section.security" },
  { href: "/security/smart-wallet", label: "Smart wallet", labelKey: "nav.smartWallet", icon: ShieldIcon, sectionKey: "nav.section.security" },
  { href: "/settings", label: "Settings", labelKey: "nav.settings", icon: SettingsIcon },
];

/** Consecutive items grouped by `sectionKey` (ungrouped items get `section: undefined`). */
export function groupNavItems(items: NavItem[]): Array<{ section?: MessageKey; items: NavItem[] }> {
  const groups: Array<{ section?: MessageKey; items: NavItem[] }> = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.section === item.sectionKey) last.items.push(item);
    else groups.push({ section: item.sectionKey, items: [item] });
  }
  return groups;
}

/** Whether a nav item is the current section for `pathname`. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  const prefixes = [item.href, ...(item.match ?? [])];
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
