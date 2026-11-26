"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "./AuthProvider";

/** Only allow same-app relative paths as post-login redirects. */
export function safeNextPath(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

/**
 * Gate for signed-in pages: shows a spinner while the session is read, and
 * sends signed-out visitors to the connect page with a `next` parameter.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "signedOut") {
      router.replace(`/?next=${encodeURIComponent(pathname ?? "/dashboard")}`);
    }
  }, [status, router, pathname]);

  if (status !== "signedIn") {
    return (
      <div className="flex min-h-screen items-center justify-center text-fg-muted">
        <Spinner size="lg" label="Checking your session" />
      </div>
    );
  }
  return <>{children}</>;
}
