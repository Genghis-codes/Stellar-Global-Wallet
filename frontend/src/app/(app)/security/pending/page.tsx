import type { Metadata } from "next";
import { PendingTxsView } from "@/components/security/PendingTxsView";

export const metadata: Metadata = { title: "Pending transactions" };

export default function PendingTxsPage() {
  return <PendingTxsView />;
}
