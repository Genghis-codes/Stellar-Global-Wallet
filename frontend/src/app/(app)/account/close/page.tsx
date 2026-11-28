import type { Metadata } from "next";
import { CloseAccountView } from "@/components/account/CloseAccountView";

export const metadata: Metadata = { title: "Close account" };

export default function CloseAccountPage() {
  return <CloseAccountView />;
}
