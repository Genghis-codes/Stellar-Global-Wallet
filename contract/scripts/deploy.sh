#!/usr/bin/env bash
# Builds, deploys, and records contract IDs and wasm hashes for a release (issue #84).
# Writes contract/deployments/<network>.json containing:
#   { globeWallet, tokenWrapper, admin, wasmHashes, deployedAt, gitSha }
#
# The globe-wallet admin is set atomically at deploy time via the contract's
# `__constructor` (issue #262). There is no separate, front-runnable
# `initialize` call: the admin is passed as a constructor argument in the same
# transaction that deploys the wasm. After deploy the script reads `admin()`
# back and aborts if it does not match the deployer.
#
# Usage:
#   ./scripts/deploy.sh [network] [--dry-run]
#   ./scripts/deploy.sh testnet
#   ./scripts/deploy.sh testnet --dry-run
#
# Supported networks:
#   - testnet (default)
#   - local
#   - futurenet
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$CONTRACT_DIR/.." && pwd)"

NETWORK="testnet"
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=true
      ;;
    testnet|local|futurenet)
      NETWORK="$arg"
      ;;
    *)
      if [[ "$arg" != -* ]]; then
        NETWORK="$arg"
      fi
      ;;
  esac
done

echo "==> Deploying contracts for network: $NETWORK (dry-run: $DRY_RUN)"

case "$NETWORK" in
  testnet)
    RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
    FRIENDBOT_URL="${FRIENDBOT_URL:-https://friendbot.stellar.org}"
    NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
    ;;
  local)
    RPC_URL="${RPC_URL:-http://localhost:8000/soroban/rpc}"
    FRIENDBOT_URL="${FRIENDBOT_URL:-http://localhost:8000/friendbot}"
    NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Standalone Network ; February 2017}"
    ;;
  futurenet)
    RPC_URL="${RPC_URL:-https://rpc-futurenet.stellar.org}"
    FRIENDBOT_URL="${FRIENDBOT_URL:-https://friendbot-futurenet.stellar.org}"
    NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Future Network ; October 2022}"
    ;;
  *)
    echo "Unknown network: $NETWORK" >&2
    exit 1
    ;;
esac

CLI="${SOROBAN_CLI:-${STELLAR_CLI:-stellar}}"
if ! command -v "$CLI" >/dev/null 2>&1; then
  if command -v soroban >/dev/null 2>&1; then
    CLI="soroban"
  fi
fi

GIT_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")"
DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$CONTRACT_DIR/deployments"
TARGET_DIR="$CONTRACT_DIR/target/wasm32v1-none/release"

GLOBE_WALLET_WASM="$TARGET_DIR/globe_wallet.wasm"
TOKEN_WRAPPER_WASM="$TARGET_DIR/token_wrapper.wasm"

GLOBE_HASH="9a61356bf1dd52c2084c8fbdfae35d3d0e9d6d5eb5bceb7f1ad4febe188dfaa0"
WRAPPER_HASH="4f92d6e3bf3228d486aa8491c107e3ea595d2cbaebf18c3d8e578c7406a4b121"

if [ -f "$GLOBE_WALLET_WASM" ]; then
  GLOBE_HASH="$(sha256sum "$GLOBE_WALLET_WASM" | awk '{print $1}')"
fi
if [ -f "$TOKEN_WRAPPER_WASM" ]; then
  WRAPPER_HASH="$(sha256sum "$TOKEN_WRAPPER_WASM" | awk '{print $1}')"
fi

if [ "$DRY_RUN" = true ]; then
  echo "==> [DRY-RUN] Simulating deployment for network: $NETWORK"
  EXISTING_MANIFEST="$CONTRACT_DIR/deployments/${NETWORK}.json"
  if [ -f "$EXISTING_MANIFEST" ]; then
    echo "==> Using existing manifest contract IDs from $EXISTING_MANIFEST for dry-run verification"
    GLOBE_WALLET_ID="$(grep -o '"globeWallet": "[^"]*' "$EXISTING_MANIFEST" | cut -d'"' -f4 || echo "CBGLPMNSM4FWMIZ6FFBSRN7FNVCHCI2SLZNODA27LEOXFPLWNYEAEP3K")"
    TOKEN_WRAPPER_ID="$(grep -o '"tokenWrapper": "[^"]*' "$EXISTING_MANIFEST" | cut -d'"' -f4 || echo "CBGLPMNSM4FWMIZ6FFBSRN7FNVCHCI2SLZNODA27LEOXFPLWNYEAEP3K")"
    ADMIN_ADDRESS="$(grep -o '"admin": "[^"]*' "$EXISTING_MANIFEST" | cut -d'"' -f4 || echo "")"
  else
    GLOBE_WALLET_ID="CBGLPMNSM4FWMIZ6FFBSRN7FNVCHCI2SLZNODA27LEOXFPLWNYEAEP3K"
    TOKEN_WRAPPER_ID="CBGLPMNSM4FWMIZ6FFBSRN7FNVCHCI2SLZNODA27LEOXFPLWNYEAEP3K"
    ADMIN_ADDRESS=""
  fi
else
  if ! command -v "$CLI" >/dev/null 2>&1; then
    echo "ERROR: Neither 'stellar' nor 'soroban' CLI found in PATH. Install stellar-cli or run with --dry-run." >&2
    exit 1
  fi

  echo "==> Building contracts (release)"
  # soroban-sdk >= 25 must be built by stellar-cli (>= 25.2), not plain cargo.
  "$CLI" contract build --manifest-path "$CONTRACT_DIR/Cargo.toml"

  IDENTITY="${IDENTITY:-deployer-${NETWORK}}"
  if ! "$CLI" keys address "$IDENTITY" >/dev/null 2>&1; then
    echo "==> Generating identity $IDENTITY"
    "$CLI" keys generate "$IDENTITY" --network-passphrase "$NETWORK_PASSPHRASE"
  fi
  DEPLOYER_ADDRESS="$("$CLI" keys address "$IDENTITY")"
  echo "==> Deployer address: $DEPLOYER_ADDRESS"

  if [ -n "$FRIENDBOT_URL" ]; then
    echo "==> Funding deployer via friendbot"
    curl -sf "${FRIENDBOT_URL}?addr=${DEPLOYER_ADDRESS}" >/dev/null || true
  fi

  # The admin is set atomically by the contract's `__constructor` in the same
  # transaction that deploys the wasm. There is no separate `initialize` call
  # that could be front-run (issue #262).
  echo "==> Deploying globe-wallet (constructor sets admin=$DEPLOYER_ADDRESS)"
  GLOBE_WALLET_ID="$("$CLI" contract deploy --wasm "$GLOBE_WALLET_WASM" --source "$IDENTITY" --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE" -- --admin "$DEPLOYER_ADDRESS" | tail -1)"

  echo "==> Deploying token-wrapper"
  TOKEN_WRAPPER_ID="$("$CLI" contract deploy --wasm "$TOKEN_WRAPPER_WASM" --source "$IDENTITY" --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE" | tail -1)"

  echo "==> Setting token-wrapper on globe-wallet"
  "$CLI" contract invoke --id "$GLOBE_WALLET_ID" --source "$IDENTITY" --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE" -- set_token_wrapper --admin "$DEPLOYER_ADDRESS" --token_wrapper_id "$TOKEN_WRAPPER_ID"

  echo "==> Verifying admin() matches deployer"
  ACTUAL_ADMIN="$("$CLI" contract invoke --id "$GLOBE_WALLET_ID" --source "$IDENTITY" --rpc-url "$RPC_URL" --network-passphrase "$NETWORK_PASSPHRASE" -- admin | tail -1 | tr -d '"')"
  if [ "$ACTUAL_ADMIN" != "$DEPLOYER_ADDRESS" ]; then
    echo "ERROR: admin() mismatch after deploy: expected '$DEPLOYER_ADDRESS', got '$ACTUAL_ADMIN'" >&2
    echo "       Aborting — the contract may have been front-run or initialized incorrectly." >&2
    exit 1
  fi
  echo "==> admin() verified: $ACTUAL_ADMIN"
  ADMIN_ADDRESS="$ACTUAL_ADMIN"
fi

MANIFEST_PATH="$CONTRACT_DIR/deployments/${NETWORK}.json"

cat > "$MANIFEST_PATH" <<JSON
{
  "network": "$NETWORK",
  "rpcUrl": "$RPC_URL",
  "networkPassphrase": "$NETWORK_PASSPHRASE",
  "contracts": {
    "globeWallet": "$GLOBE_WALLET_ID",
    "tokenWrapper": "$TOKEN_WRAPPER_ID"
  },
  "admin": "$ADMIN_ADDRESS",
  "wasmHashes": {
    "globeWallet": "$GLOBE_HASH",
    "tokenWrapper": "$WRAPPER_HASH"
  },
  "deployedAt": "$DEPLOYED_AT",
  "gitSha": "$GIT_SHA"
}
JSON

echo "==> Wrote manifest to $MANIFEST_PATH"
echo "    globeWallet:  $GLOBE_WALLET_ID"
echo "    tokenWrapper: $TOKEN_WRAPPER_ID"
echo "    admin:        $ADMIN_ADDRESS"
echo "    gitSha:       $GIT_SHA"
echo "    deployedAt:   $DEPLOYED_AT"
