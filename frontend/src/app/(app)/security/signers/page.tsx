import type { Metadata } from "next";
import { SignersView } from "@/components/security/SignersView";

export const metadata: Metadata = { title: "Signers" };

export default function SignersPage() {
  return <SignersView />;
}
