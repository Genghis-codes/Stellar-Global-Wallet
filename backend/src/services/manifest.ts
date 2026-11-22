import fs from "fs";
import path from "path";

export interface DeploymentManifest {
  network: string;
  rpcUrl: string;
  networkPassphrase: string;
  contracts: {
    globeWallet: string;
    tokenWrapper: string;
  };
  wasmHashes: {
    globeWallet: string;
    tokenWrapper: string;
  };
  deployedAt: string;
  gitSha: string;
  /** Ledger sequence at deploy time; used to detect testnet resets (issue #285). */
  ledgerSequence?: number;
}

/**
 * Loads the deployment manifest for a specified network (issue #84).
 * Checks multiple relative paths to ensure reliability across dev, test, and container environments.
 */
export function loadDeploymentManifest(network = "testnet"): DeploymentManifest | null {
  const possiblePaths = [
    path.resolve(__dirname, `../../../../contract/deployments/${network}.json`),
    path.resolve(__dirname, `../../../contract/deployments/${network}.json`),
    path.resolve(process.cwd(), `contract/deployments/${network}.json`),
    path.resolve(process.cwd(), `../contract/deployments/${network}.json`),
  ];

  for (const manifestPath of possiblePaths) {
    try {
      if (fs.existsSync(manifestPath)) {
        const raw = fs.readFileSync(manifestPath, "utf-8");
        return JSON.parse(raw) as DeploymentManifest;
      }
    } catch {
      // Continue search on error
    }
  }

  return null;
}

/**
 * Resolves the on-disk path of a network's deployment manifest, or null if
 * none of the candidate locations exist (issue #285).
 */
export function resolveDeploymentManifestPath(network = "testnet"): string | null {
  const possiblePaths = [
    path.resolve(__dirname, `../../../../contract/deployments/${network}.json`),
    path.resolve(__dirname, `../../../contract/deployments/${network}.json`),
    path.resolve(process.cwd(), `contract/deployments/${network}.json`),
    path.resolve(process.cwd(), `../contract/deployments/${network}.json`),
  ];

  for (const manifestPath of possiblePaths) {
    try {
      if (fs.existsSync(manifestPath)) {
        return manifestPath;
      }
    } catch {
      // Continue search on error
    }
  }

  return null;
}

export interface ResetDetectionInput {
  /** Ledger sequence recorded in the manifest at deploy time. */
  manifestLedgerSequence?: number;
  /** Current ledger sequence reported by the RPC. */
  currentLedgerSequence: number;
  /** Whether the manifest's globeWallet contract still exists on-chain. */
  contractExists: boolean;
}

export interface ResetDetectionResult {
  reset: boolean;
  reasons: string[];
}

/**
 * Detects a testnet reset by comparing the manifest against live chain state
 * (issue #285). A reset is signalled when the ledger sequence has dropped below
 * the deploy-time sequence, or when the deployed contract is missing on-chain.
 */
export function detectTestnetReset(input: ResetDetectionInput): ResetDetectionResult {
  const reasons: string[] = [];

  if (!input.contractExists) {
    reasons.push("contract_missing");
  }

  if (
    typeof input.manifestLedgerSequence === "number" &&
    input.currentLedgerSequence < input.manifestLedgerSequence
  ) {
    reasons.push("ledger_sequence_drop");
  }

  return { reset: reasons.length > 0, reasons };
}

/**
 * Persists an updated deployment manifest after a redeploy/reseed (issue #285).
 * Writes atomically to the resolved manifest path so clients pick up the new
 * contract IDs on their next read.
 */
export function writeDeploymentManifest(
  manifest: DeploymentManifest,
  network = manifest.network,
): boolean {
  const manifestPath = resolveDeploymentManifestPath(network);
  if (!manifestPath) {
    return false;
  }

  const tmpPath = `${manifestPath}.tmp`;
  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
    fs.renameSync(tmpPath, manifestPath);
    return true;
  } catch {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // Best-effort cleanup
    }
    return false;
  }
}
