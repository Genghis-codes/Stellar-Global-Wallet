#!/usr/bin/env bash
# Issue #183: build every contract for wasm32 and report WASM sizes, and fail
# if any contract WASM links ed25519-dalek (verification must use the
# `ed25519_verify` host function).
set -euo pipefail
cd "$(dirname "$0")/.."
# soroban-sdk >= 25 refuses plain `cargo build` for wasm and must be built
# by stellar-cli (>= 25.2), which targets wasm32v1-none.
stellar contract build
out="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
{
  echo "| contract | wasm bytes |"
  echo "|---|---|"
  for f in target/wasm32v1-none/release/*.wasm; do
    echo "| $(basename "$f") | $(wc -c <"$f") |"
  done
} >>"$out"
if cargo tree --workspace -e normal --target wasm32v1-none -i ed25519-dalek 2>/dev/null | grep -q "ed25519-dalek"; then
  echo "::error::ed25519-dalek is a normal (WASM) dependency; use env.crypto().ed25519_verify" >&2
  exit 1
fi
