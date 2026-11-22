#!/usr/bin/env bash
# Deploy the globe-wallet contract to a local quickstart network.
#
# The contract is initialized atomically at deploy time via its `__constructor`,
# so the admin is bound in the same transaction that creates the contract.
# There is no separate, front-runnable `initialize` call.
set -euo pipefail

NETWORK="${NETWORK:-local}"
RPC_URL="${RPC_URL:-http://localhost:8000/soroban/rpc}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Standalone Network ; February 2017}"
ADMIN_SECRET="${ADMIN_SECRET:-${STELLAR_SECRET_KEY:-}}"
WASM="${WASM:-target/wasm32-unknown-unknown/release/globe_wallet.wasm}"

if [[ -z "$ADMIN_SECRET" ]]; then
  echo "error: ADMIN_SECRET (or STELLAR_SECRET_KEY) must be set" >&2
  exit 1
fi

if [[ ! -f "$WASM" ]]; then
  echo "error: wasm not found at $WASM (run: cargo build --target wasm32-unknown-unknown --release)" >&2
  exit 1
fi

ADMIN_ADDRESS="$(stellar keys address "$ADMIN_SECRET" 2>/dev/null || stellar address --secret-key "$ADMIN_SECRET")"
if [[ -z "$ADMIN_ADDRESS" ]]; then
  echo "error: could not derive admin address from ADMIN_SECRET" >&2
  exit 1
fi

echo "Deploying globe-wallet to $NETWORK (admin: $ADMIN_ADDRESS)"

# Deploy + constructor args in a single transaction. The constructor receives
# the admin address and requires its authorization, so no third party can
# front-run initialization.
CONTRACT_ID="$(stellar contract deploy \
  --wasm "$WASM" \
  --source "$ADMIN_SECRET" \
  --network "$NETWORK" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- \
  --admin "$ADMIN_ADDRESS")"

if [[ -z "$CONTRACT_ID" ]]; then
  echo "error: deploy did not return a contract id" >&2
  exit 1
fi

echo "Deployed contract: $CONTRACT_ID"

# Verification: read back the stored admin and abort on mismatch.
STORED_ADMIN="$(stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_SECRET" \
  --network "$NETWORK" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  -- admin)"

if [[ "$STORED_ADMIN" != "$ADMIN_ADDRESS" ]]; then
  echo "error: admin mismatch after deploy (expected $ADMIN_ADDRESS, got $STORED_ADMIN)" >&2
  exit 1
fi

echo "Verified admin: $STORED_ADMIN"

# Emit the manifest entry consumed by the manifest pipeline.
MANIFEST="${MANIFEST:-contract/manifest.local.json}"
mkdir -p "$(dirname "$MANIFEST")"
cat > "$MANIFEST" <<EOF
{
  "network": "$NETWORK",
  "contractId": "$CONTRACT_ID",
  "admin": "$STORED_ADMIN"
}
EOF

echo "Wrote manifest: $MANIFEST"
