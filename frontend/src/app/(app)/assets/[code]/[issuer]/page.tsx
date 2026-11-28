import type { Metadata } from "next";
import { AssetDetailView } from "@/components/assets/AssetDetailView";

export const metadata: Metadata = { title: "Asset" };

export default async function AssetPage({ params }: { params: Promise<{ code: string; issuer: string }> }) {
  const { code, issuer } = await params;
  return <AssetDetailView code={decodeURIComponent(code)} issuer={issuer} />;
}
