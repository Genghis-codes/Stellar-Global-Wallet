"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GlobeIcon } from "@/components/icons";
import { NAV_ITEMS, isNavItemActive } from "@/config/nav";
import { cn } from "@/lib/cn";

export function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-2 text-fg">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-fg">
        <GlobeIcon className="h-5 w-5" />
      </span>
      <span className="text-lg font-semibold tracking-tight">GlobeWallet</span>
    </Link>
  );
}

/** Navigation list shared by the desktop sidebar and the mobile drawer. */
export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? "/";
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const active = isNavItemActive(item, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-primary/10 text-primary" : "text-fg-muted hover:bg-surface-muted hover:text-fg",
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r border-border bg-surface px-3 py-5 lg:flex">
      <Brand />
      <NavLinks />
    </aside>
  );
}
