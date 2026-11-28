"use client";

import { CopyButton } from "@/components/ui/CopyButton";
import { QrCode } from "./QrCode";

/** In-app landing page for a SEP-7 URI. */
export function paymentRequestLink(uri: string, origin = typeof window === "undefined" ? "" : window.location.origin): string {
  return `${origin}/pay?uri=${encodeURIComponent(uri)}`;
}

/** A created payment request: QR of the SEP-7 URI, plus the URI and a GlobeWallet link to copy. */
export function PaymentRequestResult({ uri }: { uri: string }) {
  const link = paymentRequestLink(uri);
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-border p-4 sm:flex-row sm:items-start" aria-live="polite">
      <QrCode value={uri} size={160} label="Payment request QR code" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div>
          <p className="text-xs font-medium text-fg-muted">Payment link</p>
          <div className="flex items-center gap-1">
            <a href={link} className="truncate text-sm text-primary hover:underline">
              {link}
            </a>
            <CopyButton value={link} label="Copy payment link" />
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-fg-muted">SEP-7 URI (for other Stellar wallets)</p>
          <div className="flex items-center gap-1">
            <code className="truncate text-xs text-fg">{uri}</code>
            <CopyButton value={uri} label="Copy SEP-7 URI" />
          </div>
        </div>
      </div>
    </div>
  );
}
