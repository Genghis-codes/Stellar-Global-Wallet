# Globe Wallet Contract

Soroban smart contract implementing the Globe Wallet: a multisig-aware smart
account with guardians, spending policies, recovery, and time-locked large
transfers.

## Overview

The contract is a smart account that holds funds and enforces policy on
outgoing transfers. It supports:

- **Multisig approvals** — configurable signer set with weighted thresholds.
- **Guardians** — trusted parties that can assist with recovery and veto
  suspicious activity.
- **Spending policies** — per-asset limits and allowlists.
- **Time-locked large transfers** — transfers above a threshold are queued and
  only executable after a delay, giving the owner or guardians time to veto.

## Time-locked large transfers

Transfers whose amount is at or above the configured `large_transfer_threshold`
are not executed immediately. Instead they create a **pending transfer** that
becomes executable only after `large_transfer_delay` ledgers have elapsed.

### Lifecycle

1. **Pending** — `transfer` (or the equivalent entry point) detects an amount
   above the threshold and records a pending transfer with an `executable_at`
   ledger. No funds move yet.
2. **Executed** — once the current ledger is at or past `executable_at`, the
   pending transfer can be executed and funds are released.
3. **Cancelled** — before execution, the owner (from another device) or any
   guardian can cancel the pending transfer. Cancellation is final.

### Veto

A delay with veto lets the real owner react to a compromise: if an attacker
queues a large transfer, the legitimate owner or a guardian can cancel it
during the delay window before any funds leave the account.

### Notifications

Every state change on a pending transfer (created, cancelled, executed) emits
an event and enqueues a notification via the outbox so off-chain services can
surface it to the owner and guardians.

### Events

| Event | Emitted when |
| --- | --- |
| `large_transfer_pending` | A transfer above the threshold is queued |
| `large_transfer_cancelled` | A pending transfer is vetoed by owner or guardian |
| `large_transfer_executed` | A pending transfer is executed after the delay |

## Building and testing

```bash
cd contract
cargo test --workspace
```

## Security notes

- Every privileged path (cancel, execute) has a negative test covering
  unauthorized callers.
- Resource usage is measured before and after changes to the transfer flow.
