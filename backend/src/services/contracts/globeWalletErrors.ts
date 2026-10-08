/**
 * Mirrors `WalletError` from Orbit-Wal/contract's
 * `contracts/globe-wallet/src/lib.rs`, so a raw `Error(Contract, #N)` string
 * surfaced by simulation can be translated into a readable name instead of
 * forcing every caller of this API to memorize contract error codes.
 *
 * CAVEAT: at the time this was written, that enum on the contract repo's
 * `main` branch has a merge-artifact duplicate discriminant —
 * `SpendLimitExceeded`/`NoAssetsProvided` are each declared twice (once at
 * 1007/1008, once again at 7/8), which keeps `contract`'s `main` from
 * compiling at all. This map reflects the codes that actually end up
 * on-chain in the deployment this backend was validated against, where the
 * duplicate was resolved by dropping the second (7/8) declaration and
 * keeping 1007/1008 — see this PR's description for how that deployment was
 * produced. That fix was applied locally only, to unblock an end-to-end
 * test deployment; it was not opened as a change against the contract repo,
 * since that's a different repo with its own issue/PR process. If the
 * contract repo resolves the duplicate differently upstream, update this
 * map to match its final numbering.
 */
export const GLOBE_WALLET_ERROR_CODES: Readonly<Record<number, string>> = {
  1001: "AlreadyInitialized",
  1002: "NotInitialized",
  1003: "Unauthorized",
  1004: "AssetAlreadyAdded",
  1005: "AssetNotFound",
  1006: "InvalidSpendLimit",
  1007: "SpendLimitExceeded",
  1008: "NoAssetsProvided",
  9: "NoPendingAdmin",
  10: "SpendOverflow",
  11: "AssetLimitExceeded",
  12: "MaxAssetsReached",
  13: "UpgradeAlreadyPending",
  14: "UpgradeNotPending",
  15: "UpgradeHashMismatch",
  16: "UpgradeNotReady",
  17: "UpgradeFailed",
  18: "GuardianAlreadyAdded",
  19: "GuardianNotFound",
  20: "InvalidRecoveryThreshold",
  21: "NotEnoughGuardians",
  22: "RecoveryNotConfigured",
  23: "RecoveryAlreadyPending",
  24: "NoPendingRecovery",
  25: "AlreadyApproved",
  26: "ApprovalNotFound",
  27: "RecoveryNotReady",
  28: "RecoveryNotQuorate",
};

const CONTRACT_ERROR_PATTERN = /Error\(Contract,\s*#(\d+)\)/;

/**
 * Extracts a `Error(Contract, #N)` code from a raw Soroban simulation/
 * transaction error string and appends its `WalletError` name, if known.
 * Falls back to returning the input unchanged when no such code is found.
 */
export function describeGlobeWalletError(raw: string): string {
  const match = raw.match(CONTRACT_ERROR_PATTERN);
  if (!match) return raw;
  const code = Number(match[1]);
  const name = GLOBE_WALLET_ERROR_CODES[code];
  return name ? `${name} (contract error #${code}): ${raw}` : raw;
}
