import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

/** Route-level loading UI shown inside the shell while a page streams in. */
export default function AppLoading() {
  return (
    <div aria-busy="true" aria-label="Loading page" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-[var(--radius-card)]" />
        ))}
      </div>
      <SkeletonText lines={4} />
    </div>
  );
}
