import type { Metadata } from "next";
import { FeatureGate } from "@/components/security/FeatureGate";
import { RecoveryView } from "@/components/smart-wallet/RecoveryView";

export const metadata: Metadata = { title: "Social recovery" };

export default function RecoveryPage() {
  return (
    <FeatureGate requires={["contract", "recovery"]} title="Social recovery">
      <RecoveryView />
    </FeatureGate>
  );
}
