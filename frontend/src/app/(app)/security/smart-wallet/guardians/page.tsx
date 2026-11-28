import type { Metadata } from "next";
import { FeatureGate } from "@/components/security/FeatureGate";
import { GuardiansView } from "@/components/smart-wallet/GuardiansView";

export const metadata: Metadata = { title: "Guardians" };

export default function GuardiansPage() {
  return (
    <FeatureGate requires={["contract", "recovery"]} title="Guardians">
      <GuardiansView />
    </FeatureGate>
  );
}
