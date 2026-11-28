import type { Metadata } from "next";
import { FeatureGate } from "@/components/security/FeatureGate";
import { AllowancesView } from "@/components/smart-wallet/AllowancesView";

export const metadata: Metadata = { title: "Allowances" };

export default function AllowancesPage() {
  return (
    <FeatureGate requires={["contract"]} title="Allowances">
      <AllowancesView />
    </FeatureGate>
  );
}
