import type { Metadata } from "next";
import { Suspense } from "react";
import { SendPage } from "@/components/send/SendPage";

export const metadata: Metadata = { title: "Send" };

export default function Send() {
  // SendPage reads pre-filled values (?to=&amount=&asset=&memo=) with useSearchParams.
  return (
    <Suspense>
      <SendPage />
    </Suspense>
  );
}
