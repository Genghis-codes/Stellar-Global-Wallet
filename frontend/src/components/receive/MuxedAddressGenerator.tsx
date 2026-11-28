"use client";

import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { AddressDisplay } from "@/components/ui/AddressDisplay";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { api } from "@/lib/api";
import { describeError } from "@/lib/api/errors";

const MAX_UINT64 = 18_446_744_073_709_551_615n;

function idError(value: string): string | null {
  if (value === "") return "Enter an ID.";
  if (!/^\d+$/.test(value)) return "Use a whole number (0 or more).";
  return BigInt(value) > MAX_UINT64 ? "The ID must fit in 64 bits (max 18446744073709551615)." : null;
}

/**
 * Derive a muxed (M...) address for this account and a numeric ID via
 * POST /account/:id/muxed. Payments to it land in the same account, tagged
 * with the ID, which is how exchanges tell depositors apart.
 */
export function MuxedAddressGenerator({ account }: { account: string }) {
  const [id, setId] = useState("");
  const [touched, setTouched] = useState(false);
  const generate = useMutation({ mutationFn: (value: string) => api.account.muxed(account, value) });
  const error = idError(id.trim());

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!error) generate.mutate(id.trim());
  }

  return (
    <Card>
      <CardHeader
        title="Muxed address"
        description="Give each payer their own address. Funds still arrive in this account, tagged with the ID."
      />
      <CardBody className="flex flex-col gap-4">
        <form onSubmit={onSubmit} noValidate className="flex items-end gap-2" aria-label="Generate muxed address">
          <div className="flex-1">
            <Input
              label="ID"
              inputMode="numeric"
              placeholder="e.g. 1001"
              value={id}
              onChange={(event) => setId(event.target.value)}
              error={touched ? (error ?? undefined) : undefined}
            />
          </div>
          <Button type="submit" variant="secondary" loading={generate.isPending} className={touched && error ? "mb-5" : undefined}>
            Generate
          </Button>
        </form>
        {generate.isError && (
          <p role="alert" className="text-sm text-danger">
            {describeError(generate.error)}
          </p>
        )}
        {generate.data && (
          <div className="rounded-lg bg-surface-muted p-3" aria-live="polite">
            <p className="mb-1 text-xs text-fg-muted">Muxed address for ID {generate.data.id}</p>
            <AddressDisplay address={generate.data.address} full />
          </div>
        )}
      </CardBody>
    </Card>
  );
}
