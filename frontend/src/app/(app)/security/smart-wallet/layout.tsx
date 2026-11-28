import type { ReactNode } from "react";
import { ContractBanners } from "@/components/smart-wallet/ContractBanners";

/** Every smart-wallet page shows contract-wide notices (upgrade, admin transfer, pause) on top. */
export default function SmartWalletLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ContractBanners />
      {children}
    </>
  );
}
