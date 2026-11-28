"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CloseIcon, MenuIcon } from "@/components/icons";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useT } from "@/hooks/useT";
import { Brand, NavLinks } from "./Sidebar";

export interface TopbarProps {
  /** Right-hand slot (account menu, network badge). */
  actions?: ReactNode;
}

export function Topbar({ actions }: TopbarProps) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);

  // Close the drawer on navigation (state adjusted during render, no effect).
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    // Move focus into the drawer, keep Tab inside it, and give it back on close.
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = drawerRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur lg:px-8">
        <button
          ref={triggerRef}
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-muted lg:hidden"
          aria-label={t("shell.openNavigation")}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen(true)}
        >
          <MenuIcon className="h-5 w-5" />
        </button>
        <div className="lg:hidden">
          <Brand />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <ThemeToggle />
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-overlay" onClick={() => setOpen(false)} aria-hidden />
          <div
            ref={drawerRef}
            id="mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label={t("shell.navigation")}
            className="absolute inset-y-0 left-0 flex w-72 flex-col gap-6 bg-surface px-3 py-5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <Brand />
              <button
                type="button"
                ref={closeRef}
                aria-label={t("shell.closeNavigation")}
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-muted"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
