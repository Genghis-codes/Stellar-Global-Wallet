"use client";

import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useEmailStatus, useSubmitEmail } from "@/hooks/useEmail";
import { EMAIL_ERROR_CODES } from "@/lib/api/endpoints/email";
import { describeError, isApiError } from "@/lib/api/errors";
import { VerifyEmailForm } from "./VerifyEmailForm";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return "Enter an email address.";
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return "Enter a valid email address.";
  return null;
}

/**
 * Notification email: shows the verified address, adds or changes it (the
 * backend sends a verification link with a code), and confirms the code.
 */
export function EmailSettings() {
  const status = useEmailStatus();
  const submit = useSubmitEmail();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = validateEmail(value);
    setError(problem);
    if (problem) return;
    const email = value.trim();
    submit.mutate(email, {
      onSuccess: () => {
        setPending(email);
        setEditing(false);
        setValue("");
        toast.show({ tone: "success", title: "Verification email sent", description: `Check ${email} for your code.` });
      },
      onError: (err) => {
        if (isApiError(err) && err.code === EMAIL_ERROR_CODES.alreadyVerified) {
          setError("This address is already verified.");
        } else if (isApiError(err) && err.code === "VALIDATION_ERROR") {
          setError("Enter a valid email address.");
        } else {
          toast.show({ tone: "danger", title: "Couldn't send the email", description: describeError(err) });
        }
      },
    });
  }

  if (status.isPending) {
    return <Skeleton className="h-40 rounded-[var(--radius-card)]" aria-label="Loading email settings" />;
  }

  const verified = status.data?.verified ? status.data.email : null;
  const showForm = editing || (!verified && !pending);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Email"
          description="Receive payment and security alerts by email."
          action={
            verified && !editing ? (
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                Change
              </Button>
            ) : undefined
          }
        />
        <CardBody className="flex flex-col gap-4">
          {status.isError ? (
            <p className="text-sm text-danger">{describeError(status.error)}</p>
          ) : verified ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-fg">
              <span className="font-medium">{verified}</span>
              <Badge tone="success">Verified</Badge>
            </p>
          ) : (
            <p className="text-sm text-fg-muted">No email address is verified yet.</p>
          )}

          {showForm && (
            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="flex-1">
                <Input
                  type="email"
                  label={verified ? "New email address" : "Email address"}
                  autoComplete="email"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  error={error ?? undefined}
                />
              </div>
              <div className="flex gap-2 sm:mt-7">
                <Button type="submit" loading={submit.isPending}>
                  Send code
                </Button>
                {editing && (
                  <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          )}
        </CardBody>
      </Card>

      {pending && (
        <VerifyEmailForm email={pending} onVerified={() => setPending(null)} onResend={() => submit.mutate(pending)} />
      )}
    </div>
  );
}
