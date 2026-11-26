import { Suspense } from "react";
import { ConnectWallet } from "@/components/auth/ConnectWallet";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

export default function HomePage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center p-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      {/* useSearchParams (the ?next= redirect) needs a Suspense boundary for static rendering. */}
      <Suspense>
        <ConnectWallet />
      </Suspense>
    </main>
  );
}
