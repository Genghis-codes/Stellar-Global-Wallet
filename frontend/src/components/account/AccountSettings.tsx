import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";

/** Settings → Account: the danger zone that leads to the close-account flow. */
export function AccountSettings() {
  return (
    <Card className="border-danger">
      <CardHeader title="Close account" description="Send everything to another account and remove this one from the network." />
      <CardBody className="flex flex-col gap-3 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between">
        <p>You&apos;ll see every step and what you get back before anything is signed.</p>
        <Link
          href="/account/close"
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-danger px-4 font-medium text-white hover:opacity-90"
        >
          Close account…
        </Link>
      </CardBody>
    </Card>
  );
}
