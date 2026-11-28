import type { Metadata } from "next";
import { ReceiveView } from "@/components/receive/ReceiveView";

export const metadata: Metadata = { title: "Receive" };

export default function ReceivePage() {
  return <ReceiveView />;
}
