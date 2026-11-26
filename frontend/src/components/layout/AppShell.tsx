import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export interface AppShellProps {
  children: ReactNode;
  topbarActions?: ReactNode;
}

/** Signed-in chrome: sidebar on desktop, top bar with a drawer on mobile. */
export function AppShell({ children, topbarActions }: AppShellProps) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar actions={topbarActions} />
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
