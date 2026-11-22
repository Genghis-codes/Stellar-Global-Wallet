/**
 * Email verification flow (#90).
 *
 * Manages the lifecycle of a user's verified email address:
 *   1. User submits their email → a token-link is sent (sendVerificationEmail)
 *   2. User clicks the link → their email is marked verified (verifyToken)
 *   3. Notification senders check isEmailVerified before delivering alerts
 *
 * Schema (created lazily on startup):
 *
 *   verified_emails(
 *     id           BIGSERIAL PK,
 *     account      VARCHAR(56) — Stellar G-address,
 *     email        TEXT        — normalised lowercase email,
 *     verified     BOOLEAN     — true after token confirmed,
 *     token        TEXT        — hex token for the verification link,
 *     token_expires_at TIMESTAMPTZ,
 *     created_at   TIMESTAMPTZ,
 *     updated_at   TIMESTAMPTZ
 *   )
 *
 * Security properties:
 *   - Tokens are 32-byte crypto-random hex strings (256-bit entropy).
 *   - Tokens expire after TOKEN_TTL_HOURS (default 24 h).
 *   - Unverified emails NEVER receive alerts (enforced in emailNotifier.ts).
 *   - One verified email per account (upsert).
 */

import crypto from "crypto";
import { Pool } from "pg";
import { StrKey } from "@stellar/stellar-sdk";
import { pool } from "../db";
import { getEmailProvider } from "./emailNotifier";
import { tNotification } from "./i18nHelper";
import { AccountMismatchError, AppError } from "../errors/appError";

const TOKEN_TTL_HOURS = 24;
const BASE_URL = process.env.BASE_URL ?? "https://app.globewallet.app";

// ── Table bootstrap ────────────────────────────────────────────────────────

export async function ensureVerifiedEmailsTable(db: Queryable = pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS verified_emails (
      id               BIGSERIAL     PRIMARY KEY,
      account          VARCHAR(56)   NOT NULL,
      email            TEXT          NOT NULL,
      verified         BOOLEAN       NOT NULL DEFAULT FALSE,
      token            TEXT,
      token_expires_at TIMESTAMPTZ,
      created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      UNIQUE (account)
    )
  `);
}

// ── Errors ─────────────────────────────────────────────────────────────────

export class EmailAlreadyVerifiedError extends AppError {
  constructor() {
    super("This email address is already verified.", {
      code: "EMAIL_ALREADY_VERIFIED",
      status: 409,
    });
  }
}

export class EmailTokenExpiredError extends AppError {
  constructor() {
    super("The email verification link has expired. Please request a new one.", {
      code: "EMAIL_TOKEN_EXPIRED",
      status: 410,
    });
  }
}

export class EmailTokenInvalidError extends AppError {
  constructor() {
    super("The email verification link is invalid.", {
      code: "EMAIL_TOKEN_INVALID",
      status: 400,
    });
  }
}

// ── Core operations ────────────────────────────────────────────────────────

/** Normalise email: lowercase, trimmed. */
function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Initiates the email verification flow for an account.
 * Sends a token-link to the given address; throws if already verified.
 */
export async function sendVerificationEmail(
  account: string,
  rawEmail: string,
  locale = "en",
  db: Queryable = pool
): Promise<void> {
  const email = normaliseEmail(rawEmail);
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);

  const { rows } = await db.query<{ verified: boolean }>(
    `SELECT verified FROM verified_emails WHERE account = $1`,
    [account]
  );

  if (rows[0]?.verified) {
    throw new EmailAlreadyVerifiedError();
  }

  await db.query(
    `INSERT INTO verified_emails (account, email, verified, token, token_expires_at, updated_at)
     VALUES ($1, $2, FALSE, $3, $4, NOW())
     ON CONFLICT (account)
     DO UPDATE SET email = EXCLUDED.email,
                   verified = FALSE,
                   token = EXCLUDED.token,
                   token_expires_at = EXCLUDED.token_expires_at,
                   updated_at = NOW()`,
    [account, email, token, expiresAt]
  );

  const verificationUrl = `${BASE_URL}/verify-email?token=${token}`;
  const subject = tNotification("email.verify.subject", locale);
  const text = tNotification("email.verify.body", locale, {
    expiresInHours: String(TOKEN_TTL_HOURS),
    verificationUrl,
  });

  await getEmailProvider().send({ to: email, subject, text });
  console.log(`[email-verification] verification email sent to ${email} for account ${account}`);
}

/**
 * Confirms a verification token. Marks the email as verified on success.
 * Throws EmailTokenInvalidError or EmailTokenExpiredError on failure.
 */
export async function verifyToken(
  token: string,
  db: Pool = pool,
  expectedAccount?: string
): Promise<{ account: string; email: string }> {
  const { rows } = await db.query<{
    account: string;
    email: string;
    verified: boolean;
    token_expires_at: Date;
  }>(
    `SELECT account, email, verified, token_expires_at
     FROM verified_emails
     WHERE token = $1`,
    [token]
  );

  if (rows.length === 0) {
    throw new EmailTokenInvalidError();
  }

  const row = rows[0];

  // #233 — Prevent cross-account token verification / email disclosure when
  // an authenticated user submits another account's verification token.
  if (
    expectedAccount &&
    StrKey.isValidEd25519PublicKey(expectedAccount) &&
    row.account !== expectedAccount
  ) {
    throw new AccountMismatchError(undefined, {
      authenticated: expectedAccount,
      requested: row.account,
    });
  }

  if (new Date() > row.token_expires_at) {
    throw new EmailTokenExpiredError();
  }

  await db.query(
    `UPDATE verified_emails
     SET verified = TRUE, token = NULL, token_expires_at = NULL, updated_at = NOW()
     WHERE account = $1`,
    [row.account]
  );

  console.log(`[email-verification] email ${row.email} verified for account ${row.account}`);
  return { account: row.account, email: row.email };
}

/**
 * Returns the verified email address for an account, or null if none exists
 * or verification is pending.  Notification senders call this before sending.
 */
export async function getVerifiedEmail(
  account: string,
  db: Queryable = pool
): Promise<string | null> {
  const { rows } = await db.query<{ email: string; verified: boolean }>(
    `SELECT email, verified FROM verified_emails WHERE account = $1`,
    [account]
  );

  if (!rows[0]?.verified) return null;
  return rows[0].email;
}
