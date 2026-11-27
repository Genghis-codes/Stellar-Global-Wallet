import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import type { MultisigInfo } from "@/lib/api/endpoints/account";
import { THRESHOLD_LEVELS } from "@/lib/multisig/thresholds";

const LEVEL_HINTS = {
  low: "Allow trust, bump sequence",
  medium: "Payments, offers, most operations",
  high: "Signers, thresholds, account merge",
} as const;

export interface ThresholdsCardProps {
  info: MultisigInfo;
  action?: ReactNode;
}

/** Low/medium/high thresholds with whether the signers can still reach each. */
export function ThresholdsCard({ info, action }: ThresholdsCardProps) {
  return (
    <Card>
      <CardHeader
        title="Thresholds"
        description={`Combined signer weight: ${info.totalWeight}`}
        action={action}
      />
      <CardBody>
        <dl className="grid gap-3 sm:grid-cols-3">
          {THRESHOLD_LEVELS.map((level) => (
            <div key={level} className="rounded-lg border border-border p-3">
              <dt className="flex items-center justify-between gap-2 text-sm font-medium capitalize text-fg">
                {level}
                {info.reachable[level] ? (
                  <Badge tone="success">Reachable</Badge>
                ) : (
                  <Badge tone="danger">Unreachable</Badge>
                )}
              </dt>
              <dd className="mt-1 text-2xl font-semibold text-fg">{info.thresholds[level]}</dd>
              <dd className="text-xs text-fg-muted">{LEVEL_HINTS[level]}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}
