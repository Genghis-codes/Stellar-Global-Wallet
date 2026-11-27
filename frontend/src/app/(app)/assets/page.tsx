import type { Metadata } from "next";
import { AssetsView } from "@/components/assets/AssetsView";

export const metadata: Metadata = { title: "Assets" };

export default function AssetsPage() {
  return <AssetsView />;
}
