import type { Metadata } from "next";
import { FeatureGate } from "@/components/security/FeatureGate";
import { SpendLimitsView } from "@/components/smart-wallet/SpendLimitsView";

export const metadata: Metadata = { title: "Spend limits" };

export default function SpendLimitsPage() {
  return (
    <FeatureGate requires={["contract"]} title="Spend limits">
      <SpendLimitsView />
    </FeatureGate>
  );
}
