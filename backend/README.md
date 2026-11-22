# Backend

API service for the Stellar Global Wallet preview. Runs on Node + Express and
serves read endpoints against a live testnet contract.

## Getting started

```bash
cp .env.example .env          # testnet defaults + a live demo contract ID
npm install
npm run dev                   # API on http://localhost:4000
npm test                      # Jest suite
npm run type-check
```

The `.env.example` points at a real testnet contract with a demo user, so read
endpoints work without deploying anything.

## Testnet reset handling

Testnet is periodically reset, which wipes deployed contracts and funded
accounts. When that happens the preview API breaks until the contract is
redeployed and the demo wallet is reseeded. The backend detects this and
recovers automatically.

### Detection

On startup and on a periodic interval the service compares the live chain
state against the recorded deployment in `contract/deployments/testnet.json`:

- **Ledger sequence drop** — the current ledger sequence is lower than the
  sequence recorded in the manifest, which only happens after a reset.
- **Missing contract** — the contract ID in the manifest no longer exists on
  chain (or its instance storage is gone).

Either condition marks the deployment as stale and triggers recovery.

### Recovery pipeline

1. Redeploy the contract to testnet.
2. Reseed the demo wallet (fund the account and recreate demo state).
3. Write the new contract ID and ledger sequence back to
   `contract/deployments/testnet.json`.
4. Notify connected clients so they reload against the new deployment.

Recovery is idempotent and guarded so concurrent triggers do not race; a
failed run leaves the manifest untouched and is retried on the next check.

### Runbook

If automatic recovery does not complete:

1. Check the service logs for the reset detection and recovery steps.
2. Confirm the live ledger sequence and contract state against
   `contract/deployments/testnet.json`.
3. Manually redeploy the contract and reseed the demo wallet using the
   contract tooling.
4. Update `contract/deployments/testnet.json` with the new contract ID and
   ledger sequence.
5. Restart the backend so clients pick up the new manifest, or wait for the
   next notification cycle.

### Tests

A simulated reset (ledger sequence drop or missing contract) should trigger
the redeploy and reseed pipeline in staging.
