import type { ReactNode } from "react";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import type { MultisigInfo } from "@/lib/api/endpoints/account";

export interface SignerListProps {
  info: MultisigInfo;
  /** The signed-in account, marked "You". */
  account: string;
  action?: ReactNode;
  /** Per-signer actions (remove, ...). */
  renderActions?: (signer: MultisigInfo["signers"][number]) => ReactNode;
}

export function SignerList({ info, account, action, renderActions }: SignerListProps) {
  const signers = [...info.signers].sort((a, b) => b.weight - a.weight);
  return (
    <Card>
      <CardHeader
        title="Signers"
        description={info.isMultisig ? "This account needs several signatures." : "A single key controls this account."}
        action={action}
      />
      <CardBody>
        <ul className="divide-y divide-border">
          {signers.map((signer) => (
            <li key={signer.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <AddressDisplay address={signer.key} copyable />
                {signer.isMaster && <Badge tone="info">Master key</Badge>}
                {signer.key === account && <Badge>You</Badge>}
                {signer.weight === 0 && <Badge tone="warning">No weight</Badge>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-fg-muted">
                  Weight <span className="font-semibold text-fg">{signer.weight}</span>
                </span>
                {renderActions?.(signer)}
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
