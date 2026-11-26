"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  /** Error message; marks the field invalid and is announced to screen readers. */
  error?: string;
  /** Content rendered inside the field on the right (an asset code, a button). */
  trailing?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, trailing, id, className, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-fg">
          {label}
        </label>
      )}
      <div
        className={cn(
          "flex h-10 items-center rounded-lg border bg-surface px-3 focus-within:ring-2 focus-within:ring-ring",
          error ? "border-danger" : "border-border",
        )}
      >
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "h-full w-full min-w-0 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted",
            className,
          )}
          {...rest}
        />
        {trailing && <div className="ml-2 flex shrink-0 items-center text-sm text-fg-muted">{trailing}</div>}
      </div>
      {error ? (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-xs text-fg-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
});
