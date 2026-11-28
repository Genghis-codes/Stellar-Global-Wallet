import type { Metadata } from "next";
import { ClaimableView } from "@/components/claimable/ClaimableView";

export const metadata: Metadata = { title: "Claimable balances" };

export default function ClaimablePage() {
  return <ClaimableView />;
}
