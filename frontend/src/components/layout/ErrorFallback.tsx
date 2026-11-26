"use client";

import { AlertIcon } from "@/components/icons";
import { Button } from "@/components/ui/Button";

export interface ErrorFallbackProps {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
}

/** Shared body for route error boundaries (error.tsx files). */
export function ErrorFallback({ error, reset, title = "Something went wrong" }: ErrorFallbackProps) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertIcon className="h-6 w-6" />
      </span>
      <h2 className="text-xl font-semibold text-fg">{title}</h2>
      <p className="max-w-md text-sm text-fg-muted">
        An unexpected error occurred. You can try again; if it keeps happening, reload the page.
      </p>
      {error.digest && <p className="font-mono text-xs text-fg-muted">Reference: {error.digest}</p>}
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
