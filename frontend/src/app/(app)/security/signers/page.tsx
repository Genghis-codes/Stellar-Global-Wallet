import type { Metadata } from "next";
import { FeatureGate } from "@/components/security/FeatureGate";
import { SignersView } from "@/components/security/SignersView";

export const metadata: Metadata = { title: "Signers" };

export default function SignersPage() {
  return (
    <FeatureGate requires={["multisig"]} title="Signers">
      <SignersView />
    </FeatureGate>
  );
}
