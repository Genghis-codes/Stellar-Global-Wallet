import type { Metadata } from "next";
import { FeatureGate } from "@/components/security/FeatureGate";
import { SmartWalletView } from "@/components/smart-wallet/SmartWalletView";

export const metadata: Metadata = { title: "Smart wallet" };

export default function SmartWalletPage() {
  return (
    <FeatureGate requires={["contract"]} title="Smart wallet">
      <SmartWalletView />
    </FeatureGate>
  );
}
