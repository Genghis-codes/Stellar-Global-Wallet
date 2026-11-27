import type { Metadata } from "next";
import { Suspense } from "react";
import { ActivityView } from "@/components/activity/ActivityView";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  // ActivityView keeps its tab and filters in the URL (useSearchParams), which needs a Suspense boundary.
  return (
    <Suspense>
      <ActivityView />
    </Suspense>
  );
}
