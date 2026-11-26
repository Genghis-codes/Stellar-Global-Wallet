"use client";

import "./globals.css";

/** Last-resort boundary for errors thrown by the root layout itself. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center font-sans text-fg">
        <h1 className="text-2xl font-semibold">GlobeWallet hit an unexpected error</h1>
        {error.digest && <p className="font-mono text-xs text-fg-muted">Reference: {error.digest}</p>}
        <button
          type="button"
          onClick={reset}
          className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
