import { Badge } from "@/components/ui/Badge";
import { env } from "@/lib/env";
import { NETWORK_LABELS } from "@/lib/stellar/network";

/** Shows which Stellar network the app is configured for; loud on test networks. */
export function NetworkBadge() {
  const label = NETWORK_LABELS[env.network];
  return (
    <Badge tone={env.network === "mainnet" ? "success" : "warning"} title={`Stellar ${label}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </Badge>
  );
}
