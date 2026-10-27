#!/usr/bin/env bash
#
# Build the globe-wallet contract wasm and generate TypeScript bindings
# into packages/bindings/globe-wallet.
#
# Usage: contract/scripts/bindings.sh
#
# Requires the Stellar CLI (https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli)
# with the `contract bindings typescript` subcommand available.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${CONTRACT_DIR}/.." && pwd)"

# Stellar CLI >= 25 builds for wasm32v1-none; older releases used
# wasm32-unknown-unknown. Accept whichever the installed CLI produced.
WASM_CANDIDATES=(
  "${CONTRACT_DIR}/target/wasm32v1-none/release/globe_wallet.wasm"
  "${CONTRACT_DIR}/target/wasm32-unknown-unknown/release/globe_wallet.wasm"
)
OUTPUT_DIR="${REPO_ROOT}/packages/bindings/globe-wallet"

if ! command -v stellar >/dev/null 2>&1; then
  echo "error: 'stellar' CLI not found on PATH. Install it from https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli" >&2
  exit 1
fi

echo "==> Building globe-wallet contract wasm"
(
  cd "${CONTRACT_DIR}"
  stellar contract build
)

WASM_PATH=""
for candidate in "${WASM_CANDIDATES[@]}"; do
  if [[ -f "${candidate}" ]]; then
    WASM_PATH="${candidate}"
    break
  fi
done

if [[ -z "${WASM_PATH}" ]]; then
  echo "error: globe_wallet.wasm was not produced by 'stellar contract build' (looked in: ${WASM_CANDIDATES[*]})" >&2
  exit 1
fi

echo "==> Generating TypeScript bindings into ${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}"
stellar contract bindings typescript \
  --wasm "${WASM_PATH}" \
  --output-dir "${OUTPUT_DIR}" \
  --overwrite

echo "==> Done. Bindings written to ${OUTPUT_DIR}"
