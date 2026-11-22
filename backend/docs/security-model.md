# Security & Privacy Model

This document describes the threat model, the personal data we store, and the
retention and deletion guarantees for the backend. It is the reference for
issue #261 (data retention and privacy).

## Threat model

- **Assets:** user emails, registered devices, user preferences, audit log
  entries, and recovery metadata.
- **Adversaries:** an attacker with read access to the database (backup leak,
  SQL injection, misconfigured replica) and a curious operator.
- **Goals:** minimise the personal data we keep, bound how long we keep it, and
  let a user export or erase everything tied to their account.
- **Non-goals:** defending against a fully compromised application host (it can
  read live data by design) or against the user themselves.

## Data inventory

| Data | Where | Personal? | Retention |
| --- | --- | --- | --- |
| Email address | `users.email` | Yes | Life of the account; erased on deletion |
| Registered devices | `devices` | Yes (device identifiers) | Purged when stale (see below) |
| User preferences | `preferences` | Yes (behavioural) | Life of the account; erased on deletion |
| Audit log entries | `audit_log` | Yes (actor + metadata) | Purged after the retention window |
| Recovery metadata | recovery tables | Yes | Life of the account; erased on deletion |

## Retention

- **Audit logs** are retained for a bounded window and then purged by the
  retention job. Only the fields needed for security review are kept; free-form
  metadata is not stored.
- **Stale devices** that have not been seen within the retention window are
  removed by the retention job so abandoned identifiers do not accumulate.
- Retention jobs are idempotent and safe to run repeatedly; they only delete
  rows older than the configured window.

## Export and deletion

- **Export:** an authenticated user can request a machine-readable export of all
  personal data we hold for them (email, devices, preferences, audit entries).
- **Deletion:** an authenticated user can request erasure of all personal data.
  Deletion removes emails, devices, preferences, and audit log entries for that
  user. The operation is scoped strictly to the authenticated user; requests for
  other users are rejected.

## Failure modes

- A retention job that fails part-way leaves already-deleted rows deleted and
  the rest intact; the next run resumes. No partial row is left behind because
  each delete is a single statement.
- Export and deletion require authentication; unauthenticated or cross-user
  requests return the shared error envelope with a stable error code.

## Contracts

- Every privileged path (export, deletion, retention) has a negative test
  covering unauthenticated and cross-user access.
- Amounts are handled as strings and addresses are checksum-validated at the
  edge, consistent with the rest of the backend.
