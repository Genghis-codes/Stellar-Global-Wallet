"use client";

import { useEffect } from "react";
import { ErrorFallback } from "@/components/layout/ErrorFallback";

/** Errors inside app pages keep the shell (sidebar/top bar) on screen. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ErrorFallback error={error} reset={reset} />;
}
