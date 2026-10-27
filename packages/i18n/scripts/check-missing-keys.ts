#!/usr/bin/env tsx
/**
 * Missing-key completeness check (#92, #91).
 *
 * Verifies that every error code defined in the backend's AppError
 * hierarchy is present in packages/i18n/errors/en.json, and that every
 * notification key referenced in the notification workers is present in
 * packages/i18n/notifications/en.json.
 *
 * Exit 1 when any key is missing — CI runs this via `npm run i18n:check`.
 */

import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadJson(relPath: string): Record<string, string> {
  const abs = path.join(root, relPath);
  return JSON.parse(fs.readFileSync(abs, "utf-8")) as Record<string, string>;
}

// ── Canonical error codes ──────────────────────────────────────────────────
// Read straight from backend/src/errors/codes.ts (the ERROR_CODES list) so a
// new backend code can never ship without copy. A hand-maintained list here
// drifted badly: most codes the API returns were missing.
function loadBackendErrorCodes(): string[] {
  const codesPath = path.resolve(root, "..", "..", "backend", "src", "errors", "codes.ts");
  const source = fs.readFileSync(codesPath, "utf-8");
  const start = source.indexOf("ERROR_CODES = [");
  const end = source.indexOf("] as const", start);
  if (start === -1 || end === -1) {
    throw new Error(`Could not find the ERROR_CODES list in ${codesPath}`);
  }
  return [...source.slice(start, end).matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]);
}

const REQUIRED_ERROR_KEYS: string[] = loadBackendErrorCodes();

// ── Canonical notification keys ────────────────────────────────────────────
// Keep in sync with:
//   backend/src/services/paymentNotifier.ts
//   backend/src/services/recoveryNotifier.ts
//   backend/src/services/emailNotifier.ts
const REQUIRED_NOTIFICATION_KEYS: string[] = [
  "payment.received.title",
  "payment.received.body",
  "recovery.initiated.title",
  "recovery.initiated.body",
  "recovery.approved.title",
  "recovery.approved.body",
  "guardian.added.title",
  "guardian.added.body",
  "guardian.removed.title",
  "guardian.removed.body",
  "guardian.approval_needed.title",
  "guardian.approval_needed.body",
  "email.verify.subject",
  "email.verify.body",
  "email.recovery_initiated.subject",
  "email.recovery_initiated.body",
  "email.large_send.subject",
  "email.large_send.body",
];

function check(
  label: string,
  catalogue: Record<string, string>,
  required: string[]
): string[] {
  return required.filter((key) => !(key in catalogue));
}

const errorsEn = loadJson("errors/en.json");
const notificationsEn = loadJson("notifications/en.json");

const missingErrors = check("errors/en.json", errorsEn, REQUIRED_ERROR_KEYS);
const missingNotifications = check(
  "notifications/en.json",
  notificationsEn,
  REQUIRED_NOTIFICATION_KEYS
);

let failed = false;

if (missingErrors.length > 0) {
  console.error("❌  Missing keys in errors/en.json:");
  missingErrors.forEach((k) => console.error(`   - ${k}`));
  failed = true;
}

if (missingNotifications.length > 0) {
  console.error("❌  Missing keys in notifications/en.json:");
  missingNotifications.forEach((k) => console.error(`   - ${k}`));
  failed = true;
}

if (!failed) {
  console.log(
    `✅  i18n catalogues complete (${REQUIRED_ERROR_KEYS.length} error keys, ` +
      `${REQUIRED_NOTIFICATION_KEYS.length} notification keys).`
  );
  process.exit(0);
} else {
  process.exit(1);
}
