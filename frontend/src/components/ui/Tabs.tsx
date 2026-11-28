"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  /** Controlled selected tab id. */
  value: string;
  onChange: (id: string) => void;
  className?: string;
  "aria-label"?: string;
}

/** WAI-ARIA tabs with roving focus (arrow keys, Home, End). Controlled. */
export function Tabs({ items, value, onChange, className, "aria-label": ariaLabel }: TabsProps) {
  const baseId = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = items.filter((item) => !item.disabled);

  function focusTab(id: string) {
    onChange(id);
    tabRefs.current[id]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = enabled.findIndex((item) => item.id === value);
    if (index === -1 || enabled.length === 0) return;
    let next: TabItem | undefined;
    if (event.key === "ArrowRight") next = enabled[(index + 1) % enabled.length];
    else if (event.key === "ArrowLeft") next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled[enabled.length - 1];
    if (next) {
      event.preventDefault();
      focusTab(next.id);
    }
  }

  const selected = items.find((item) => item.id === value);

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className="flex gap-1 border-b border-border"
      >
        {items.map((item) => {
          const isSelected = item.id === value;
          return (
            <button
              key={item.id}
              ref={(node) => {
                tabRefs.current[item.id] = node;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={isSelected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => onChange(item.id)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40",
                isSelected
                  ? "border-primary text-fg"
                  : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {selected && (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${selected.id}`}
          aria-labelledby={`${baseId}-tab-${selected.id}`}
          tabIndex={0}
          className="rounded-lg pt-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {selected.content}
        </div>
      )}
    </div>
  );
}
