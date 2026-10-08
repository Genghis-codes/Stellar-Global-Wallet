import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "../../config";
import { SorobanService, ContractCallResult } from "../soroban";
import { SorobanNotConfiguredError, SorobanSimulationError, SorobanTransactionError } from "../sorobanErrors";
import { describeGlobeWalletError } from "./globeWalletErrors";

export interface AssetInfo {
  code: string;
  issuer: string | null;
}

function requireContractId(): string {
  if (!config.GLOBE_WALLET_CONTRACT_ID) {
    throw new SorobanNotConfiguredError();
  }
  return config.GLOBE_WALLET_CONTRACT_ID;
}

/** Re-throws Soroban errors with contract-specific error codes translated to readable names. */
function withWalletErrorTranslation<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((err: unknown) => {
    if (err instanceof SorobanSimulationError) {
      throw new SorobanSimulationError(describeGlobeWalletError(err.raw ?? err.message), err.raw);
    }
    if (err instanceof SorobanTransactionError) {
      throw new SorobanTransactionError(describeGlobeWalletError(err.message), err.hash);
    }
    throw err;
  });
}

/**
 * Typed access to the deployed `globe-wallet` Soroban contract
 * (Orbit-Wal/contract, contracts/globe-wallet). Encodes/decodes ScVal
 * arguments for the specific functions this backend calls; generic
 * simulate/invoke/poll mechanics live in {@link SorobanService}.
 */
export class GlobeWalletContract {
  constructor(private readonly soroban: SorobanService) {}

  /** Read-only: the caller's whitelisted assets. Free — simulated, never submitted. */
  async getAssets(userPublicKey: string): Promise<AssetInfo[]> {
    const contractId = requireContractId();
    return withWalletErrorTranslation(
      this.soroban.simulate<AssetInfo[]>({
        contractId,
        method: "get_assets",
        sourcePublicKey: userPublicKey,
        args: [StellarSdk.nativeToScVal(userPublicKey, { type: "address" })],
      })
    );
  }

  /**
   * Records a spend against the caller's daily limit for `assetCode`,
   * rejecting (via simulation, before any fee is paid) if it would exceed
   * that limit. `userSecretKey` both signs and authorizes — `record_spend`
   * calls `user.require_auth()` for this exact account.
   */
  async recordSpend(params: {
    userSecretKey: string;
    assetCode: string;
    /** Amount in the asset's smallest unit (stroops), as a decimal string. */
    amount: string;
  }): Promise<ContractCallResult<null>> {
    const contractId = requireContractId();
    const { userSecretKey, assetCode, amount } = params;
    const userPublicKey = StellarSdk.Keypair.fromSecret(userSecretKey).publicKey();
    return withWalletErrorTranslation(
      this.soroban.invoke<null>({
        contractId,
        method: "record_spend",
        sourceSecretKey: userSecretKey,
        args: [
          StellarSdk.nativeToScVal(userPublicKey, { type: "address" }),
          StellarSdk.nativeToScVal(assetCode, { type: "string" }),
          StellarSdk.nativeToScVal(BigInt(amount), { type: "i128" }),
        ],
      })
    );
  }
}
