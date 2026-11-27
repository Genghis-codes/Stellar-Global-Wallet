"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { useVerifyEmail } from "@/hooks/useEmail";
import { EMAIL_ERROR_CODES } from "@/lib/api/endpoints/email";
import { describeError, isApiError } from "@/lib/api/errors";

export interface VerifyEmailFormProps {
  email: string;
  onVerified: () => void;
  onResend: () => void;
}

/** Second step: paste the code from the verification email. */
export function VerifyEmailForm({ email, onVerified, onResend }: VerifyEmailFormProps) {
  const verify = useVerifyEmail();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const token = code.trim();
    if (!token) {
      setError("Enter the code from the email.");
      return;
    }
    setError(null);
    verify.mutate(token, {
      onSuccess: ({ email: confirmed }) => {
        toast.show({ tone: "success", title: "Email verified", description: confirmed });
        onVerified();
      },
      onError: (err) => {
        if (isApiError(err) && err.code === EMAIL_ERROR_CODES.tokenExpired) {
          setError("This code has expired. Send a new one.");
        } else if (
          isApiError(err) &&
          (err.code === EMAIL_ERROR_CODES.tokenInvalid || err.code === "ACCOUNT_MISMATCH")
        ) {
          setError("This code isn't valid for your account.");
        } else {
          setError(describeError(err));
        }
      },
    });
  }

  return (
    <Card>
      <CardHeader title="Verify your email" description={`We sent a verification code to ${email}.`} />
      <CardBody>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-1">
            <Input
              label="Verification code"
              autoComplete="one-time-code"
              spellCheck={false}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              error={error ?? undefined}
            />
          </div>
          <div className="flex gap-2 sm:mt-7">
            <Button type="submit" loading={verify.isPending}>
              Verify
            </Button>
            <Button type="button" variant="ghost" onClick={onResend}>
              Resend
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
