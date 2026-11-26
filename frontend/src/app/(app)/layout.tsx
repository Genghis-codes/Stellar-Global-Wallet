import type { ReactNode } from "react";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppShell } from "@/components/layout/AppShell";

/** Every page under (app)/ requires a SEP-10 session and renders inside the shell. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell topbarActions={<AccountMenu />}>{children}</AppShell>
    </RequireAuth>
  );
}
