import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" description="Your balances and recent activity." />
      <EmptyState title="Nothing here yet" description="Connect a wallet to see your balances." />
    </>
  );
}
