import type { Metadata } from "next";
import { TransactionDetailView } from "@/components/activity/TransactionDetailView";

export const metadata: Metadata = { title: "Transaction" };

export default async function TransactionPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  return <TransactionDetailView hash={hash} />;
}
