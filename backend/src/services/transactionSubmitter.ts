/**
 * Transaction submission service with locking, retries, and status tracking.
 *
 * Handles submission with tx_bad_seq retry logic, account locking to prevent
 * concurrent submissions from the same account, and built transaction validation.
 * Optionally tracks status via Redis for real-time updates.
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import { AccountLock } from "./locks/accountLock";
import { BuiltTransactionRegistry } from "./builtTransactions";
import { config } from "../config";
import { BUILD_TIMEOUT_SECONDS } from "./transactionEnvelope";
import {
  DestinationNotFundedError,
  MemoRequiredError,
  PathExpiredError,
  SequenceConflictError,
  TransactionAlreadySubmittedError,
  TransactionExpiredError,
} from "./stellarErrors";
import { fromStroops, toStroops } from "../utils/stroops";
import { baseAccountId } from "./transactionBuilder";
import { HorizonService } from "./horizonService";

/** Maximum number of tx_bad_seq retries before giving up. */
export const MAX_SEQ_RETRIES = 3;

/** How many ms to pause between retries (exponential back-off seed). */
export const RETRY_BASE_DELAY_MS = 200;

/** Path payment result codes that mean "the quote no longer holds" rather than deterministic failure. */
export const PATH_EXPIRED_OPERATION_CODES = ["op_too_few_offers", "op_under_dest_min", "op_over_source_max"];

export interface TransactionSubmitterOptions {
  horizonService: HorizonService;
  accountLock: AccountLock;
  builtTransactionRegistry?: BuiltTransactionRegistry;
  statusStore?: {
    record: (hash: string, accountId: string) => Promise<void>;
    update: (hash: string, status: string, details?: any) => Promise<void>;
  };
}

export class TransactionSubmitter {
  private horizonService: HorizonService;
  private accountLock: AccountLock;
  private builtTransactionRegistry?: BuiltTransactionRegistry;
  private statusStore?: {
    record: (hash: string, accountId: string) => Promise<void>;
    update: (hash: string, status: string, details?: any) => Promise<void>;
  };

  constructor(options: TransactionSubmitterOptions) {
    this.horizonService = options.horizonService;
    this.accountLock = options.accountLock;
    this.builtTransactionRegistry = options.builtTransactionRegistry;
    this.statusStore = options.statusStore;
  }

  /**
   * Submit a payment with automatic tx_bad_seq retry and status tracking.
   */
  async sendPayment(params: {
    sourceSecretKey: string;
    destinationPublicKey: string;
    amount: string;
    asset?: string;
    memo?: string;
  }): Promise<{ hash: string; ledger: number; successful: boolean } | { hash: string; status: "pending" }> {
    const { sourceSecretKey, destinationPublicKey, amount, asset, memo } = params;
    const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecretKey);
    const sourcePublicKey = sourceKeypair.publicKey();

    // SEP-29: check whether the destination account requires a memo
    assertMemoProvided(
      destinationPublicKey,
      await this.horizonService.destinationRequiresMemo(destinationPublicKey),
      memo
    );

    // Resolve operation type
    const operationType = await this.getSendOperationType(destinationPublicKey, asset, amount);

    return this.submitWithSeqRetry(
      sourcePublicKey,
      sourceKeypair,
      "sendPayment",
      (sourceAccount) => {
        const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
          fee: StellarSdk.BASE_FEE,
          networkPassphrase: config.NETWORK_PASSPHRASE,
        })
          .addOperation(this.buildSendOperation(destinationPublicKey, asset, amount, operationType))
          .setTimeout(BUILD_TIMEOUT_SECONDS);
        if (memo) builder.addMemo(StellarSdk.Memo.text(memo));
        return builder;
      }
    );
  }

  /**
   * Submit a path payment strict send with automatic tx_bad_seq retry.
   */
  async pathPaymentStrictSend(params: {
    sourceSecretKey: string;
    sendAsset: string;
    sendAmount: string;
    destinationPublicKey: string;
    destAsset: string;
    destMin: string;
    path: string[];
    memo?: string;
  }): Promise<{ hash: string; ledger: number; successful: boolean } | { hash: string; status: "pending" }> {
    const { sourceSecretKey, sendAsset, sendAmount, destinationPublicKey, destAsset, destMin, path, memo } = params;
    const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecretKey);
    const sourcePublicKey = sourceKeypair.publicKey();

    return this.submitWithSeqRetry(
      sourcePublicKey,
      sourceKeypair,
      "pathPaymentStrictSend",
      (sourceAccount) => {
        const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
          fee: StellarSdk.BASE_FEE,
          networkPassphrase: config.NETWORK_PASSPHRASE,
        })
          .addOperation(
            StellarSdk.Operation.pathPaymentStrictSend({
              sendAsset: this.parseAsset(sendAsset),
              sendAmount,
              destination: destinationPublicKey,
              destAsset: this.parseAsset(destAsset),
              destMin,
              path: path.map((p) => this.parseAsset(p)),
            })
          )
          .setTimeout(BUILD_TIMEOUT_SECONDS);
        if (memo) builder.addMemo(StellarSdk.Memo.text(memo));
        return builder;
      }
    );
  }

  /**
   * Submit a path payment strict receive with automatic tx_bad_seq retry.
   */
  async pathPaymentStrictReceive(params: {
    sourceSecretKey: string;
    sendAsset: string;
    sendMax: string;
    destinationPublicKey: string;
    destAsset: string;
    destAmount: string;
    path: string[];
    memo?: string;
  }): Promise<{ hash: string; ledger: number; successful: boolean } | { hash: string; status: "pending" }> {
    const { sourceSecretKey, sendAsset, sendMax, destinationPublicKey, destAsset, destAmount, path, memo } = params;
    const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecretKey);
    const sourcePublicKey = sourceKeypair.publicKey();

    return this.submitWithSeqRetry(
      sourcePublicKey,
      sourceKeypair,
      "pathPaymentStrictReceive",
      (sourceAccount) => {
        const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
          fee: StellarSdk.BASE_FEE,
          networkPassphrase: config.NETWORK_PASSPHRASE,
        })
          .addOperation(
            StellarSdk.Operation.pathPaymentStrictReceive({
              sendAsset: this.parseAsset(sendAsset),
              sendMax,
              destination: destinationPublicKey,
              destAsset: this.parseAsset(destAsset),
              destAmount,
              path: path.map((p) => this.parseAsset(p)),
            })
          )
          .setTimeout(BUILD_TIMEOUT_SECONDS);
        if (memo) builder.addMemo(StellarSdk.Memo.text(memo));
        return builder;
      }
    );
  }

  /**
   * Submit a pre-built signed transaction with status tracking.
   */
  async submitSigned(params: { signedXdr: string }): Promise<{ hash: string; ledger: number; successful: boolean } | { hash: string; status: "pending" }> {
    let transaction: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction;
    try {
      transaction = StellarSdk.TransactionBuilder.fromXDR(params.signedXdr, config.NETWORK_PASSPHRASE);
    } catch {
      throw new Error("Invalid transaction XDR");
    }

    const hash = Buffer.from(transaction.hash()).toString("hex");
    const innerTx = "innerTransaction" in transaction ? transaction.innerTransaction : transaction;
    const sourcePublicKey = baseAccountId(innerTx.source);

    // Record status
    await this.statusStore?.record(hash, sourcePublicKey);

    // Verify built transaction registry if available
    if (this.builtTransactionRegistry) {
      try {
        await this.builtTransactionRegistry.verify({ transaction, hash, sourcePublicKey });
      } catch (err) {
        await this.statusStore?.update(hash, "failed", { errorMessage: (err as Error).message });
        throw err;
      }
    }

    try {
      const response = await this.horizonService["server"].submitTransaction(transaction);
      
      // Update status on success
      await this.statusStore?.update(hash, "success", { ledger: response.ledger });
      
      return { hash: response.hash, ledger: response.ledger, successful: response.successful };
    } catch (err: any) {
      // Gateway timeout - status will be resolved by polling
      if (err.response?.status === 504) {
        await this.statusStore?.update(hash, "pending", { errorMessage: "Gateway timeout - status unknown, client should poll later" });
        return { hash, status: "pending" };
      }

      // Update status with error
      await this.statusStore?.update(hash, "failed", { 
        errorMessage: err.message,
        resultCodes: this.getResultCodes(err),
      });

      throw this.translateSubmissionError(err, sourcePublicKey);
    }
  }

  /**
   * Internal: submit with automatic tx_bad_seq retry and exponential backoff.
   */
  private async submitWithSeqRetry(
    sourcePublicKey: string,
    sourceKeypair: StellarSdk.Keypair,
    methodName: string,
    buildTransactionBuilder: (
      account: ConstructorParameters<typeof StellarSdk.TransactionBuilder>[0]
    ) => StellarSdk.TransactionBuilder
  ): Promise<{ hash: string; ledger: number; successful: boolean } | { hash: string; status: "pending" }> {
    const result = await this.accountLock.withLock(sourcePublicKey, async (lease) => {
      let lastAttemptError: unknown;
      for (let attempt = 0; attempt <= MAX_SEQ_RETRIES; attempt++) {
        if (attempt > 0) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.log(
            `[transactionSubmitter] ${methodName} tx_bad_seq retry ${attempt}/${MAX_SEQ_RETRIES} ` +
              `for ${sourcePublicKey} — waiting ${delay}ms`
          );
          await new Promise((r) => setTimeout(r, delay));
        }

        const sourceAccount = await this.horizonService.getAccount(sourcePublicKey);
        const builder = buildTransactionBuilder(sourceAccount);
        const tx = builder.build();
        tx.sign(sourceKeypair);

        const hash = Buffer.from(tx.hash()).toString("hex");
        await this.statusStore?.record(hash, sourcePublicKey);

        try {
          const response = await this.horizonService["server"].submitTransaction(tx);
          if (attempt > 0) {
            console.log(
              `[transactionSubmitter] ${methodName} tx_bad_seq retry ${attempt}/${MAX_SEQ_RETRIES} ` +
                `succeeded for ${sourcePublicKey}`
            );
          }
          await this.statusStore?.update(hash, "success", { ledger: response.ledger });
          return { hash: response.hash, ledger: response.ledger, successful: response.successful };
        } catch (err) {
          if (this.isTxBadSeq(err) && attempt < MAX_SEQ_RETRIES) {
            lastAttemptError = err;
            continue;
          }
          
          // Update status before throwing
          const status = this.classifyError(err);
          await this.statusStore?.update(hash, status, {
            errorMessage: (err as Error).message,
            resultCodes: this.getResultCodes(err),
          });
          
          throw this.translateSubmissionError(err, sourcePublicKey);
        }
      }
      throw this.translateSubmissionError(lastAttemptError, sourcePublicKey);
    });

    // Re-throw the locked result to preserve the response shape
    return result;
  }

  /**
   * Get the send operation type (payment vs createAccount).
   */
  private async getSendOperationType(
    destinationPublicKey: string,
    asset?: string,
    amount?: string
  ): Promise<"payment" | "createAccount"> {
    const stellarAsset = asset ? this.parseAsset(asset) : StellarSdk.Asset.native();
    const destination = await this.horizonService.loadAccountOrNull(destinationPublicKey);

    if (destination) {
      return "payment";
    }

    if (!stellarAsset.isNative()) {
      throw new DestinationNotFundedError(
        `Destination account ${destinationPublicKey} does not exist. Only XLM can be sent to a ` +
          `new account (at least 1 XLM, via createAccount).`,
        { reason: "NON_NATIVE_ASSET", destination: destinationPublicKey, minimumStartingBalance: "1" }
      );
    }

    if (amount) {
      const amountStroops = BigInt(toStroops(amount));
      const minStartingBalance = BigInt(toStroops("1"));
      if (amountStroops < minStartingBalance) {
        throw new DestinationNotFundedError(
          `Destination account ${destinationPublicKey} does not exist. Creating it requires a ` +
            `starting balance of at least 1 XLM.`,
          { reason: "BELOW_MINIMUM_STARTING_BALANCE", destination: destinationPublicKey, minimumStartingBalance: "1" }
        );
      }
    }

    return "createAccount";
  }

  private buildSendOperation(
    destinationPublicKey: string,
    asset?: string,
    amount?: string,
    operationType: "payment" | "createAccount" = "payment"
  ): StellarSdk.xdr.Operation {
    if (operationType === "createAccount") {
      return StellarSdk.Operation.createAccount({
        destination: destinationPublicKey,
        startingBalance: amount ?? "1",
      });
    }
    return StellarSdk.Operation.payment({
      destination: destinationPublicKey,
      asset: asset ? this.parseAsset(asset) : StellarSdk.Asset.native(),
      amount: amount ?? "0",
    });
  }

  private parseAsset(asset: string): StellarSdk.Asset {
    return asset.toUpperCase() === "XLM" ? StellarSdk.Asset.native() : new StellarSdk.Asset(asset.split(":")[0], asset.split(":")[1]);
  }

  private isTxBadSeq(err: unknown): boolean {
    return (err as { response?: { extras?: { result_codes?: { transaction?: string } } } })?.response?.extras?.result_codes?.transaction === "tx_bad_seq";
  }

  private classifyError(err: unknown): "failed" | "expired" | "pending" | "success" {
    const resultCodes = this.getResultCodes(err);
    
    if (resultCodes?.includes("tx_too_late")) {
      return "expired";
    }
    
    if (resultCodes?.includes("tx_already_submitted")) {
      return "success";
    }

    if (resultCodes?.includes("tx_bad_seq")) {
      return "pending"; // Will be resolved by polling
    }

    return "failed";
  }

  private getResultCodes(err: unknown): string | undefined {
    return (err as { response?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } })?.response?.extras?.result_codes?.transaction;
  }

  private translateSubmissionError(err: unknown, sourcePublicKey?: string): unknown {
    // Memo required (SEP-29)
    if (err instanceof MemoRequiredError) {
      return err;
    }

    // Path expired
    const resultCodes = (err as { response?: { extras?: { result_codes?: { operations?: string[] } } } })?.response?.extras?.result_codes;
    if (resultCodes?.operations?.some((code) => PATH_EXPIRED_OPERATION_CODES.includes(code))) {
      return new PathExpiredError(resultCodes);
    }

    // Transaction expired
    if ((err as { response?: { extras?: { result_codes?: { transaction?: string } } } })?.response?.extras?.result_codes?.transaction === "tx_too_late") {
      return new TransactionExpiredError("The transaction expired before it was processed");
    }

    // Already submitted
    if ((err as { response?: { extras?: { result_codes?: { transaction?: string } } } })?.response?.extras?.result_codes?.transaction === "tx_already_submitted") {
      const hash = (err as { hash?: string })?.hash || "unknown";
      return new TransactionAlreadySubmittedError(hash || "unknown");
    }

    // Sequence conflict (after retries)
    if ((err as { response?: { extras?: { result_codes?: { transaction?: string } } } })?.response?.extras?.result_codes?.transaction === "tx_bad_seq") {
      return new SequenceConflictError(
        `Sequence conflict for account ${sourcePublicKey}. The account sequence changed during submission.`,
        resultCodes
      );
    }

    // Generic Horizon error
    if (err instanceof Error) {
      return err;
    }

    return err;
  }
}

/**
 * Check if a memo is provided when required.
 */
function assertMemoProvided(destination: string, requiresMemo: boolean, memo?: string): void {
  if (requiresMemo && (!memo || memo.trim() === "")) {
    throw new MemoRequiredError(
      `The destination account ${destination} requires a memo for transactions. ` +
        "Build the transaction again with a memo to avoid losing funds. (SEP-29)"
    );
  }
}
