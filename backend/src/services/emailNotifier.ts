/**
 * Email notification fallback channel (#90).
 *
 * Sends transactional emails (security alerts, large-send warnings) via a
 * pluggable provider abstraction.  Emails are ONLY sent to addresses that
 * have been verified through the token-link flow in emailVerification.ts.
 *
 * Provider abstraction
 * ────────────────────
 * The active provider is selected via config.EMAIL_PROVIDER:
 *   "resend"   — Resend API (recommended; set RESEND_API_KEY)
 *   "ses"      — AWS SES v2 HTTP API (set AWS_SES_* vars)
 *   "console"  — Logs to stdout; safe default for dev/test
 *
 * Deduplication
 * ─────────────
 * Callers pass an `eventId` that is stored in Redis (SET NX, 48-hour TTL)
 * to prevent duplicate emails on retry loops.
 *
 * Templates
 * ─────────
 * All subject / body strings come from the @globe-wallet/i18n catalogue
 * (packages/i18n/notifications/en.json) — no hard-coded English strings.
 */

import { createClient } from "redis";
import { config } from "../config";
import { tNotification } from "./i18nHelper";
import { getVerifiedEmail } from "./emailVerification";
import { withServiceRole } from "../db";

const DEDUP_KEY_PREFIX = `orbit-wal:${config.STELLAR_NETWORK}:email-dedup:`;
const DEDUP_TTL_SECONDS = 48 * 60 * 60;

// ── Provider abstraction ───────────────────────────────────────────────────

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

/** Console provider — safe for dev and tests. */
class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    console.log(
      `[email-notifier:console] To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`
    );
  }
}

/** Resend API provider (https://resend.com). */
class ResendEmailProvider implements EmailProvider {
  private readonly apiKey: string;
  private readonly from: string;

  constructor(apiKey: string, from: string) {
    this.apiKey = apiKey;
    this.from = from;
  }

  async send(message: EmailMessage): Promise<void> {
    const body = JSON.stringify({
      from: this.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
    });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body,
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Resend API error ${res.status}: ${detail}`);
    }
  }
}

/** AWS SES v2 provider via the HTTP API. */
class SesEmailProvider implements EmailProvider {
  private readonly region: string;
  private readonly from: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;

  constructor(opts: {
    region: string;
    from: string;
    accessKeyId: string;
    secretAccessKey: string;
  }) {
    this.region = opts.region;
    this.from = opts.from;
    this.accessKeyId = opts.accessKeyId;
    this.secretAccessKey = opts.secretAccessKey;
  }

  async send(message: EmailMessage): Promise<void> {
    // AWS SES SendEmail v2 via plain fetch — avoids @aws-sdk dependency.
    // Request signing (SigV4) is required; this is a minimal implementation.
    // Production deployments should use @aws-sdk/client-sesv2 or an
    // IAM-aware proxy instead of embedding credentials here.
    const url = `https://email.${this.region}.amazonaws.com/v2/email/outbound-emails`;
    const body = JSON.stringify({
      FromEmailAddress: this.from,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: { Data: message.subject },
          Body: { Text: { Data: message.text } },
        },
      },
    });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // NOTE: SigV4 signing required in production. Provide pre-signed
        // credentials via an AWS SDK or a request-signing middleware.
        "X-Amz-Security-Token": this.secretAccessKey,
      },
      body,
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`SES API error ${res.status}: ${detail}`);
    }
  }
}

let _provider: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (_provider) return _provider;

  const providerName = (process.env.EMAIL_PROVIDER ?? "console") as string;

  if (providerName === "resend") {
    const apiKey = process.env.RESEND_API_KEY ?? "";
    const from = process.env.EMAIL_FROM ?? "noreply@globewallet.app";
    _provider = new ResendEmailProvider(apiKey, from);
  } else if (providerName === "ses") {
    _provider = new SesEmailProvider({
      region: process.env.AWS_SES_REGION ?? "us-east-1",
      from: process.env.EMAIL_FROM ?? "noreply@globewallet.app",
      accessKeyId: process.env.AWS_SES_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.AWS_SES_SECRET_ACCESS_KEY ?? "",
    });
  } else {
    _provider = new ConsoleEmailProvider();
  }

  return _provider;
}

/** Override the provider (used in tests with a fake transport). */
export function setEmailProvider(provider: EmailProvider): void {
  _provider = provider;
}

// ── Redis deduplication ────────────────────────────────────────────────────

let dedupClient: ReturnType<typeof createClient> | undefined;

function getDedupClient() {
  if (!dedupClient) {
    dedupClient = createClient({ url: config.REDIS_URL });
    dedupClient.on("error", (err: Error) =>
      console.error("[email-notifier] redis error", err.message)
    );
  }
  return dedupClient;
}

async function markSeen(eventId: string): Promise<boolean> {
  const client = getDedupClient();
  if (!client.isOpen) await client.connect();
  const key = `${DEDUP_KEY_PREFIX}${eventId}`;
  const result = await client.set(key, "1", { NX: true, EX: DEDUP_TTL_SECONDS });
  return result === "OK";
}

// ── Public send helpers ────────────────────────────────────────────────────

/**
 * Send a recovery-initiated security alert to an email address.
 * Only fires if the email is verified (caller must check via emailVerification.ts).
 *
 * @param to       Verified destination email address
 * @param eventId  Soroban event ID for deduplication
 * @param locale   BCP-47 locale (falls back to "en")
 */
export async function sendRecoveryAlertEmail(
  to: string,
  eventId: string,
  locale = "en"
): Promise<void> {
  const isNew = await markSeen(`recovery:${eventId}`);
  if (!isNew) {
    console.log(`[email-notifier] duplicate recovery event ${eventId}, skipping`);
    return;
  }

  const subject = tNotification("email.recovery_initiated.subject", locale);
  const text = tNotification("email.recovery_initiated.body", locale, { eventId });

  await getEmailProvider().send({ to, subject, text });
  console.log(`[email-notifier] recovery alert sent to ${to}`);
}

/**
 * Send a large-send warning email.
 *
 * @param to          Verified destination email address
 * @param operationId Horizon operation ID for deduplication
 * @param amount      Payment amount string
 * @param asset       Asset code (e.g. "XLM")
 * @param destination Recipient Stellar address
 * @param locale      BCP-47 locale
 */
export async function sendLargeSendEmail(
  to: string,
  operationId: string,
  amount: string,
  asset: string,
  destination: string,
  locale = "en"
): Promise<void> {
  const isNew = await markSeen(`largesend:${operationId}`);
  if (!isNew) return;

  const subject = tNotification("email.large_send.subject", locale, { amount, asset });
  const text = tNotification("email.large_send.body", locale, { amount, asset, destination });

  await getEmailProvider().send({ to, subject, text });
  console.log(`[email-notifier] large-send alert sent to ${to}`);
}

/**
 * Claimable-balance email (#289): a balance was created for the account or
 * is about to expire. Sent only when the account has a verified email;
 * deduplicated per balance and notification kind.
 */
export async function sendClaimableBalanceEmail(params: {
  account: string;
  balanceId: string;
  amount: string;
  asset: string;
  kind: "created" | "expiring";
  expiresAt?: string;
  locale?: string;
}): Promise<void> {
  // Background worker: no request-scoped account context, so read under the
  // service role (verified_emails is RLS-protected).
  const to = await withServiceRole((tx) => getVerifiedEmail(params.account, tx), {
    jobName: "emailNotifier.claimableBalance",
  });
  if (!to) return;

  const isNew = await markSeen(`claimable:${params.kind}:${params.balanceId}`);
  if (!isNew) return;

  const locale = params.locale ?? "en";
  const vars: Record<string, string> = {
    amount: params.amount,
    asset: params.asset,
    balanceId: params.balanceId,
    expiresAt: params.expiresAt ?? "",
  };
  const prefix =
    params.kind === "created"
      ? "email.claimable_balance_created"
      : "email.claimable_balance_expiring";
  const subject = tNotification(`${prefix}.subject`, locale, vars);
  const text = tNotification(`${prefix}.body`, locale, vars);

  await getEmailProvider().send({ to, subject, text });
  console.log(`[email-notifier] claimable-balance (${params.kind}) email sent to ${to}`);
}
