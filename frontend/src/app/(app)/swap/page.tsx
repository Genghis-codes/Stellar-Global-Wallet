import type { Metadata } from "next";
import { SwapView } from "@/components/swap/SwapView";

export const metadata: Metadata = { title: "Swap" };

export default function SwapPage() {
  return <SwapView />;
}
