import type { Metadata } from "next";
import { FeatureGate } from "@/components/security/FeatureGate";
import { PendingTxsView } from "@/components/security/PendingTxsView";

export const metadata: Metadata = { title: "Pending transactions" };

export default function PendingTxsPage() {
  return (
    <FeatureGate requires={["multisig"]} title="Pending transactions">
      <PendingTxsView />
    </FeatureGate>
  );
}
