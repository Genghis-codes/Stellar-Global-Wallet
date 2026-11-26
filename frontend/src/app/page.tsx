import { Suspense } from "react";
import { ConnectWallet } from "@/components/auth/ConnectWallet";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Card, CardBody } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

/** Static placeholder with the card's footprint, so the prerendered HTML is not blank. */
function ConnectWalletSkeleton() {
  return (
    <Card className="w-full max-w-md" aria-busy="true" aria-label="Loading">
      <CardBody className="flex flex-col items-center gap-5 p-8">
        <Skeleton className="h-14 w-14 rounded-2xl" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </CardBody>
    </Card>
  );
}

export default function HomePage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center p-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      {/* useSearchParams (the ?next= redirect) needs a Suspense boundary for static rendering. */}
      <Suspense fallback={<ConnectWalletSkeleton />}>
        <ConnectWallet />
      </Suspense>
    </main>
  );
}
