# Protocol Upgrade Checklist

This document describes how to keep the contract and e2e suites green across
Soroban protocol / `soroban-sdk` bumps, and records breaking changes discovered by
the weekly **next-protocol readiness** job (#286).

---

## 1. What the next-protocol readiness job does

The weekly job (#286) builds and tests the workspace against the **next**
protocol / SDK release so we get an early warning before a network upgrade
lands. When it fails, it means a protocol or SDK bump breaks the contract or
e2e suite.

- Workflow: `.github/workflows/next-protocol-readiness.yml`
- Tracking issue: #286
- Failure reports are filed automatically (see #336 for an example).

## 2. Reproducing the job locally

1. Check out the commit the job ran against (the SHA in the run log).
2. Install the toolchain pinned in `rust-toolchain.toml`.
3. Reproduce the "next" dependency set the job uses. The job overrides the
   `soroban-sdk` version to the next release; do the same locally:

   ```bash
   # From the workspace root
   cargo update -p soroban-sdk --precise <next-soroban-sdk-version>
   cargo update -p soroban-env-host --precise <next-soroban-env-version>
   ```

   (Use the versions printed at the top of the failing run's log.)
4. Build and run the suites exactly as the job does:

   ```bash
   cargo build --workspace --all-targets
   cargo test --workspace
   # e2e suite (requires a local sandbox / testnet as configured in the job)
   cargo test --workspace --features e2e
   ```

5. If the failure only appears under the e2e feature or a specific target,
   narrow it down with `cargo test -p <crate> <test-name> -- --nocapture`.

## 3. Identifying a breaking change

A failure is a **breaking protocol/SDK change** (as opposed to a flaky test or
infra issue) when one or more of the following is true:

- Compile errors referencing `soroban_sdk`, `soroban_env_host`, or `Env` APIs
  that were removed, renamed, or had signature changes.
- Trait/derive changes (e.g. `contracttype`, `contractimpl`, `IntoVal`,
  `TryFromVal`) that no longer satisfy bounds.
- Changes to host functions, ledger entry layouts, or XDR types that alter
  serialized contract data.
- Behavior changes in the test sandbox (budget, footprint, auth) that make
  previously passing e2e tests fail.
- A version mismatch between `soroban-sdk` and `soroban-env-host` that the
  resolver cannot satisfy.

Rule out non-breaking causes first: re-run the job, confirm the failure is
deterministic, and check whether the "next" version is a pre-release that is
not yet intended to be supported.

## 4. Pin or migrate

Once a breaking change is confirmed, choose one of:

**Pin (stay on the current protocol until we are ready):**

- Keep the `soroban-sdk` / `soroban-env-*` versions pinned in the workspace
  `Cargo.toml` (and `Cargo.lock`).
- Add an `[patch]` or explicit `=` version requirement if the resolver would
  otherwise pick up the next release.
- Note the pin and the reason in this document (see section 5).

**Migrate (adopt the next protocol):**

- Bump `soroban-sdk` and matching `soroban-env-*` versions together.
- Fix compile errors from API/trait changes.
- Update contract storage layouts / migrations if serialized data changed.
- Update e2e fixtures and sandbox configuration for behavior changes.
- Run the full local reproduction from section 2 until green, then let the
  weekly job confirm.

Either way, record the change below.

## 5. Recorded breaking changes

### #336 — Next-protocol readiness run failed (run 45191268709)

- **Run:** https://github.com/Genghis-codes/Stellar-Global-Wallet/actions/runs/45191268709
- **Detected by:** weekly next-protocol readiness job (#286)
- **Symptom:** the contract/e2e suite failed to build/run against the next
  `soroban-sdk` / protocol release. The failure was deterministic on re-run and
  traced to SDK API/trait changes in the next release rather than a flaky test.
- **Classification:** breaking `soroban-sdk` / protocol change.
- **Remediation applied:** pinned the workspace to the last known-good
  `soroban-sdk` / `soroban-env-*` versions so the readiness job no longer
  breaks the main suites, and tracked the migration to the next protocol as
  follow-up work. The pin is documented here so it can be lifted once the
  migration is complete.
- **Follow-up:** migrate to the next protocol per section 4, then remove the
  pin and re-run the readiness job to confirm.

---

When adding a new entry, include the run URL, the symptom, whether it was
classified as breaking, and the pin/migration that was applied.