"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface CopyButtonProps {
  value: string;
  /** Accessible label, e.g. "Copy address". */
  label?: string;
  className?: string;
  onCopied?: () => void;
}

/** Icon button that copies `value` to the clipboard and briefly shows a check. */
export function CopyButton({ value, label = "Copy", className, onCopied }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(true);
    onCopied?.();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg",
        className,
      )}
    >
      {copied ? (
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-success" fill="currentColor" aria-hidden>
          <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.58l7.3-7.3a1 1 0 0 1 1.4 0Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <rect x="7" y="7" width="10" height="10" rx="2" />
          <path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
        </svg>
      )}
    </button>
  );
}
