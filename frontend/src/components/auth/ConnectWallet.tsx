"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GlobeIcon } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { useAuth } from "./AuthProvider";
import { NetworkBadge } from "./NetworkBadge";
import { safeNextPath } from "./RequireAuth";

/** Connect + sign-in card shown on the landing page. */
export function ConnectWallet() {
  const { status, signIn, signingIn, error, wallet } = useAuth();
  const router = useRouter();
  const next = safeNextPath(useSearchParams()?.get("next"));
  const [installed, setInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    wallet.isAvailable().then((available) => active && setInstalled(available));
    return () => {
      active = false;
    };
  }, [wallet]);

  useEffect(() => {
    if (status === "signedIn") router.replace(next);
  }, [status, router, next]);

  return (
    <Card className="w-full max-w-md">
      <CardBody className="flex flex-col items-center gap-5 p-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-fg">
          <GlobeIcon className="h-8 w-8" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Welcome to GlobeWallet</h1>
          <p className="mt-2 text-sm text-fg-muted">
            Connect {wallet.name} and sign a one-time challenge to prove you own your Stellar account. Your keys never
            leave your wallet.
          </p>
        </div>
        <NetworkBadge />
        {installed === false ? (
          <div className="flex w-full flex-col gap-2">
            <a
              href={wallet.installUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-primary px-6 text-base font-medium text-primary-fg hover:bg-primary-hover"
            >
              Install {wallet.name}
            </a>
            <p className="text-xs text-fg-muted">Reload this page after installing the extension.</p>
          </div>
        ) : (
          <Button size="lg" fullWidth loading={signingIn || status === "signedIn"} onClick={() => void signIn()}>
            Connect {wallet.name}
          </Button>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
