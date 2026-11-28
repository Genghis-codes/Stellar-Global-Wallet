"use client";

import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAppConfig, useFeatureFlags } from "@/hooks/useServerConfig";

/**
 * Backend capabilities a security screen can depend on:
 * - `multisig`, `recovery`: flags from GET /api/v1/flags;
 * - `contract`: a globe-wallet contract is configured (GET /api/v1/config).
 */
export type SecurityFeature = "multisig" | "recovery" | "contract";

const MESSAGES: Record<SecurityFeature, string> = {
  multisig: "Multisig isn't enabled on this server.",
  recovery: "Social recovery isn't enabled on this server.",
  contract: "No smart-wallet contract is configured on this server.",
};

/** Which of `features` are on; null while loading. Errors count as off. */
export function useSecurityFeatures(features: SecurityFeature[]): Record<SecurityFeature, boolean> | null {
  const needsFlags = features.some((feature) => feature !== "contract");
  const needsConfig = features.includes("contract");
  const flags = useFeatureFlags();
  const config = useAppConfig();
  if ((needsFlags && flags.isPending) || (needsConfig && config.isPending)) return null;
  return {
    multisig: flags.data?.multisig === true,
    recovery: flags.data?.recovery === true,
    contract: config.data?.features.contract === true,
  };
}

export interface FeatureGateProps {
  requires: SecurityFeature[];
  /** Page title, for the unavailable state. */
  title: string;
  children: ReactNode;
}

/** Renders `children` only when every required backend feature is on. */
export function FeatureGate({ requires, title, children }: FeatureGateProps) {
  const enabled = useSecurityFeatures(requires);
  if (!enabled) return <Skeleton className="h-40 rounded-[var(--radius-card)]" />;
  const missing = requires.filter((feature) => !enabled[feature]);
  if (missing.length > 0) {
    return (
      <EmptyState
        title={`${title} isn't available`}
        description={missing.map((feature) => MESSAGES[feature]).join(" ")}
      />
    );
  }
  return <>{children}</>;
}
