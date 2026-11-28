"use client";

import { useSearchParams } from "next/navigation";
import { PayRequestView } from "./PayRequestView";

export function PayRequestPage() {
  return <PayRequestView uri={useSearchParams().get("uri")} />;
}
