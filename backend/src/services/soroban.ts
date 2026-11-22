import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "../config";
import {
  SorobanRebuildRequiredError,
  SorobanSimulationError,
  SorobanTransactionError,
  SorobanUnavailableError,
} from "./sorobanErrors";
import {
  getCachedSimulate,
  setCachedSimulate,
  markPendingTransaction,
  clearPendingTransaction,
} from "./sorobanCache";
import { SourceAccountNotFoundError, TransactionExpiredError } from "./stellarErrors";
import {
  installUpstreamHttpGuards,
  isUpstreamValidationFailure,
  validateSorobanAccount,
  validateSorobanGetTransaction,
  validateSorobanLatestLedger,
  validateSorobanSendTransaction,
  validateSorobanSimulation,
} from "./upstreamValidation";
import {
  assertNotExpired,
  BUILD_TIMEOUT_SECONDS,
  describeUnsignedTransaction,
  parseSignedTransaction,
  SubmitSignedPending,
  SubmitSignedResult,
  UnsignedTransactionInfo,
} from "./transactionEnvelope";
import { withSpan } from "../telemetry";
import { metrics } from "./metrics";
import { recordFeeEstimate } from "./feeAccuracy";

const { rpc } = StellarSdk;

// Soroban RPC's getTransaction reports NOT_FOUND until the ledger closes
// (~5s on testnet/mainnet). Polling every 1.5s up to 30s comfortably covers
// normal ledger close time plus retries without hanging a request forever.
const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 30_000;

export interface ContractCallResult<T = unknown> {
  result: T;
  hash: string;
  ledger: number;
}

/** A simulated and assembled invocation, ready for the user to sign. */
export interface PreparedInvocation extends UnsignedTransactionInfo {
  /** Soroban resource fee (stroops) added to the inclusion fee by simulation. */
  minResourceFee: string;
  /**
   * Authorization entries from simulation, base64 XDR. Entries that use
   * address credentials must be signed too; source-account entries are
   * covered by signing the envelope.
   */
  authEntries: string[];
  /** Ledger the simulation ran against. */
  latestLedger: number;
  /**
   * Present when simulation found archived entries in the footprint (#185):
   * an unsigned RestoreFootprint transaction that must be signed and
   * submitted *before* the main transaction. The main transaction's
   * sequence number already accounts for it (restore = n+1, invoke = n+2).
   */
  restore?: {
    transactionXdr: string;
    hash: string;
    minResourceFee: string;
  };
}

/**
 * Builds a RestoreFootprint transaction from a simulation's
 * `restorePreamble` (#185). The resource fee from the preamble is added to
 * the base fee, and the preamble's footprint is attached as Soroban data so
 * the network restores exactly the archived entries the invocation needs.
 */
export function buildRestoreTransaction(
  sourceAccount: StellarSdk.Account,
  restorePreamble: { minResourceFee: string; transactionData: StellarSdk.SorobanDataBuilder },
  networkPassphrase: string,
  timeoutSeconds = 30
): StellarSdk.Transaction {
  const fee = (BigInt(StellarSdk.BASE_FEE) + BigInt(restorePreamble.minResourceFee)).toString();
  return new StellarSdk.TransactionBuilder(sourceAccount, { fee, networkPassphrase })
    .setSorobanData(restorePreamble.transactionData.build())
    .addOperation(StellarSdk.Operation.restoreFootprint({}))
    .setTimeout(timeoutSeconds)
    .build();
}

export interface SorobanServiceOptions {
  rpcUrl?: string;
  networkPassphrase?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export class SorobanService {
  private readonly server: StellarSdk.rpc.Server;
  private readonly networkPassphrase: string;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;

  constructor(options: SorobanServiceOptions = {}) {
    const rpcUrl = options.rpcUrl ?? config.SOROBAN_RPC_URL;
    this.networkPassphrase = options.networkPassphrase ?? config.SOROBAN_NETWORK_PASSPHRASE;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.pollTimeoutMs = options.pollTimeoutMs ?? POLL_TIMEOUT_MS;
    this.server = new rpc.Server(rpcUrl, {
      allowHttp: rpcUrl.startsWith("http://"),
    });
  }

  /**
   * Simulates a contract call and returns the decoded return value without
   * ever submitting a transaction. Use for read-only functions (e.g.
   * `get_assets`) — free, no state change, no signing key required. The
   * given `sourcePublicKey` only pays the (simulated, never-charged)
   * transaction's nominal source-account role; it does not need to match
   * any address referenced by the call.
   */
  async simulate<T = unknown>(params: {
    contractId: string;
    method: string;
    args: StellarSdk.xdr.ScVal[];
    sourcePublicKey: string;
  }): Promise<T> {
    const { contractId, method, args, sourcePublicKey } = params;

    // #86 — Redis cache: encode args as base64 XDR for a stable cache key.
    // scValToNative is not round-trippable, so we key on the raw XDR bytes.
    const argsKey = Buffer.from(args.map((a) => a.toXDR("base64")).join("|")).toString(
      "base64"
    );
    const cached = await getCachedSimulate<T>(contractId, method, argsKey, sourcePublicKey);
    if (cached !== null) return cached;

    // Simulation never checks the source's sequence number, so a read with
    // no natural caller (e.g. guardians(), #51) can use an account that
    // doesn't exist on-chain — same fallback as buildUnsignedTransaction.
    let sourceAccount: StellarSdk.Account;
    try {
      sourceAccount = validateSorobanAccount(
        await this.server.getAccount(sourcePublicKey),
        this.maxResponseBytes
      );
    } catch (err) {
      if (isUpstreamValidationFailure(err)) {
        throw err;
      }
      sourceAccount = new StellarSdk.Account(sourcePublicKey, "0");
    }
    const tx = this.buildInvocation(sourceAccount, contractId, method, args);

    let sim: StellarSdk.rpc.Api.SimulateTransactionResponse;
    try {
      sim = await this.server.simulateTransaction(tx);
    } catch {
      throw new SorobanUnavailableError();
    }
    if (rpc.Api.isSimulationError(sim)) {
      throw new SorobanSimulationError(
        `Simulation failed for ${contractId}.${method}: ${sim.error}`,
        sim.error
      );
    }
    const result = this.parseSimResult<T>(sim);
    await setCachedSimulate(contractId, method, argsKey, result);
    return result;
  }

  /**
   * Simulates, then — only if simulation succeeds — assembles, signs, and
   * submits the invocation, polling until the network reports a final
   * status. `sourceSecretKey` both pays the fee and provides the signature;
   * for globe-wallet's user-scoped functions (e.g. `record_spend`) this must
   * be the same account passed as the `user` argument, since that's whose
   * `require_auth()` the contract checks.
   */
  async invoke<T = unknown>(params: {
    contractId: string;
    method: string;
    args: StellarSdk.xdr.ScVal[];
    sourceSecretKey: string;
  }): Promise<ContractCallResult<T>> {
    const { contractId, method, args, sourceSecretKey } = params;
    const keypair = StellarSdk.Keypair.fromSecret(sourceSecretKey);
    const sourcePublicKey = keypair.publicKey();

    // Mark this user as having a pending transaction (read-your-writes)
    await markPendingTransaction(sourcePublicKey);

    let sourceAccount = validateSorobanAccount(
      await this.server.getAccount(sourcePublicKey),
      this.maxResponseBytes
    );
    let tx = this.buildInvocation(sourceAccount, contractId, method, args);

    // Simulation-before-submission: this is what lets us reject a doomed
    // call (bad args, insufficient auth, a contract error like
    // SpendLimitExceeded) before ever paying network fees or waiting on
    // ledger close. sendTransaction is never reached below this point on a
    // failed simulation.
    let sim = validateSorobanSimulation(
      await this.server.simulateTransaction(tx),
      this.maxResponseBytes
    );
    if (rpc.Api.isSimulationError(sim)) {
      // Transaction failed before submission - clear the pending flag
      await clearPendingTransaction(sourcePublicKey);
      throw new SorobanSimulationError(
        `Simulation failed for ${contractId}.${method}: ${sim.error}`,
        sim.error
      );
    }

    // #185 — archived entries in the footprint: restore them first, then
    // rebuild and re-simulate against the restored state.
    if (rpc.Api.isSimulationRestore(sim)) {
      await this.submitRestore(keypair, sim.restorePreamble);
      sourceAccount = validateSorobanAccount(
        await this.server.getAccount(sourcePublicKey),
        this.maxResponseBytes
      );
      tx = this.buildInvocation(sourceAccount, contractId, method, args);
      sim = validateSorobanSimulation(
        await this.server.simulateTransaction(tx),
        this.maxResponseBytes
      );
      if (rpc.Api.isSimulationError(sim)) {
        await clearPendingTransaction(sourcePublicKey);
        throw new SorobanSimulationError(
          `Simulation failed for ${contractId}.${method} after restore: ${sim.error}`,
          sim.error
        );
      }
    }

    // #287 — capture the simulated resource fee so we can compare it against
    // the fee the network actually charges once the tx is confirmed.
    const estimatedResourceFee = this.extractResourceFee(sim);

    const assembled = rpc.assembleTransaction(tx, sim).build();
    assembled.sign(keypair);

    const sendResponse = await this.server.sendTransaction(assembled);
    if (sendResponse.status === "ERROR") {
      await clearPendingTransaction(sourcePublicKey);
      throw new SorobanTransactionError(
        `Submission failed for ${contractId}.${method}`,
        sendResponse.errorResult?.toXDR("base64")
      );
    }

    const final = await this.pollTransaction(sendResponse.hash);
    await clearPendingTransaction(sourcePublicKey);

    // #287 — record estimate vs actual resource fee for accuracy tracking.
    this.recordFeeAccuracy(assembled.hash().toString("hex"), estimatedResourceFee, final);

    return {
      result: this.parseTransactionResult<T>(final),
      hash: sendResponse.hash,
      ledger: final.ledger,
    };
  }

  /**
   * #287 — pulls the resource fee (stroops) out of a successful simulation
   * response. Returns "0" when the response carries no resource fee (e.g.
   * a plain read), so callers can still record a comparison.
   */
  private extractResourceFee(
    sim: StellarSdk.rpc.Api.SimulateTransactionResponse
  ): string {
    if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
      const fee = (sim as { minResourceFee?: string }).minResourceFee;
      if (fee) return fee;
    }
    return "0";
  }

  /**
   * #287 — compares the simulated resource fee against the resource fee the
   * network actually charged and records the delta for dashboards/alerts.
   * Failures here must never break a successful submission.
   */
  private recordFeeAccuracy(
    hash: string,
    estimatedResourceFee: string,
    final: StellarSdk.rpc.Api.GetSuccessfulTransactionResponse
  ): void {
    try {
      const actualResourceFee = this.extractActualResourceFee(final);
      recordFeeEstimate({
        hash,
        kind: "soroban",
        estimatedFee: estimatedResourceFee,
        actualFee: actualResourceFee,
      });
    } catch {
      // Metrics are best-effort; never fail a confirmed transaction.
    }
  }

  /**
   * #287 — reads the resource fee actually charged from a confirmed
   * transaction's result meta. Falls back to "0" when the meta is absent.
   */
  private extractActualResourceFee(
    final: StellarSdk.rpc.Api.GetSuccessfulTransactionResponse
  ): string {
    const meta = (final as { resultMetaXdr?: string }).resultMetaXdr;
    if (!meta) return "0";
    try {
      const parsed = StellarSdk.xdr.TransactionMeta.fromXDR(meta, "base64");
      const sorobanMeta = parsed.sorobanMeta();
      if (!sorobanMeta) return "0";
      return sorobanMeta.ext().v1().totalRefundableFee().toString();
    } catch {
      return "0";
    }
  }

  private async pollTransaction(
    hash: string
  ): Promise<StellarSdk.rpc.Api.GetSuccessfulTransactionResponse> {
    const deadline = Date.now() + this.pollTimeoutMs;
    while (Date.now() < deadline) {
      const res = await this.server.getTransaction(hash);
      if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return res as StellarSdk.rpc.Api.GetSuccessfulTransactionResponse;
      }
      if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new SorobanTransactionError(
          `Transaction ${hash} failed on-chain`,
          (res as { resultXdr?: string }).resultXdr
        );
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    throw new SorobanTransactionError(`Timed out waiting for transaction ${hash}`);
  }

  private async submitRestore(
    keypair: StellarSdk.Keypair,
    restorePreamble: { minResourceFee: string; transactionData: StellarSdk.SorobanDataBuilder }
  ): Promise<void> {
    const account = await this.server.getAccount(keypair.publicKey());
    const restoreTx = buildRestoreTransaction(
      account,
      restorePreamble,
      this.networkPassphrase
    );
    restoreTx.sign(keypair);
    const sendResponse = await this.server.sendTransaction(restoreTx);
    if (sendResponse.status === "ERROR") {
      throw new SorobanTransactionError(
        "RestoreFootprint submission failed",
        sendResponse.errorResult?.toXDR("base64")
      );
    }
    await this.pollTransaction(sendResponse.hash);
  }

  private buildInvocation(
    sourceAccount: StellarSdk.Account,
    contractId: string,
    method: string,
    args: StellarSdk.xdr.ScVal[]
  ): StellarSdk.Transaction {
    return new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.invokeContractFunction({
          contract: contractId,
          function: method,
          args,
        })
      )
      .setTimeout(BUILD_TIMEOUT_SECONDS)
      .build();
  }

  private parseSimResult<T>(
    sim: StellarSdk.rpc.Api.SimulateTransactionResponse
  ): T {
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
      throw new SorobanSimulationError("Simulation returned no result");
    }
    return StellarSdk.scValToNative(sim.result.retval) as T;
  }

  private parseTransactionResult<T>(
    final: StellarSdk.rpc.Api.GetSuccessfulTransactionResponse
  ): T {
    const returnValue = final.returnValue;
    if (!returnValue) {
      throw new SorobanTransactionError("Transaction returned no value");
    }
    return StellarSdk.scValToNative(returnValue) as T;
  }
}
