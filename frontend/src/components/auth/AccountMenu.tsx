"use client";

import { useRouter } from "next/navigation";
import { LogoutIcon } from "@/components/icons";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { accountUrl } from "@/lib/stellar/explorer";
import { useAuth } from "./AuthProvider";
import { NetworkBadge } from "./NetworkBadge";

/** Top-bar account area: network, the signed-in address and sign out. */
export function AccountMenu() {
  const { account, signOut } = useAuth();
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.replace("/");
  }

  return (
    <div className="flex items-center gap-2">
      <NetworkBadge />
      {account && (
        <span className="hidden rounded-lg border border-border px-2 py-1 sm:inline-flex">
          <AddressDisplay address={account} href={accountUrl(account)} />
        </span>
      )}
      <button
        type="button"
        onClick={handleSignOut}
        aria-label="Sign out"
        title="Sign out"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-muted hover:text-fg"
      >
        <LogoutIcon className="h-5 w-5" />
      </button>
    </div>
  );
}
