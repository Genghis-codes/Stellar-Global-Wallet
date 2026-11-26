"use client";

import { useEffect } from "react";
import { ErrorFallback } from "@/components/layout/ErrorFallback";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="flex min-h-screen items-center justify-center">
      <ErrorFallback error={error} reset={reset} />
    </main>
  );
}
