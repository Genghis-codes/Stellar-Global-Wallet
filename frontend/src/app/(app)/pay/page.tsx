import type { Metadata } from "next";
import { Suspense } from "react";
import { PayRequestPage } from "@/components/pay/PayRequestPage";

export const metadata: Metadata = { title: "Payment request" };

export default function Pay() {
  // PayRequestPage reads ?uri= with useSearchParams, which needs a Suspense boundary.
  return (
    <Suspense>
      <PayRequestPage />
    </Suspense>
  );
}
