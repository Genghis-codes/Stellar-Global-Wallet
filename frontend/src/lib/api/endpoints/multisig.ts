import type { ApiClient } from "../client";
import type { AccountId } from "../types";

/**
 * The multisig slice of /api/v1/wallet (backend/src/routes/wallet.ts and
 * routes/clientSigning.ts): signer thresholds, the unsigned `setOptions`
 * builder and the client-signed submit. All routes need a session for the
 * same account.
 */

export interface SignerWeight {
  key: AccountId;
  weight: number;
}

/** GET /wallet/:publicKey/thresholds */
export interface AccountThresholds {
  lowThreshold: number;
  mediumThreshold: number;
  highThreshold: number;
  signers: SignerWeight[];
}

/** POST /wallet/set-options/build body. Omitted fields stay unchanged. */
export interface SetOptionsInput {
  sourcePublicKey: AccountId;
  /** Add a signer or change its weight. */
  addSigners?: SignerWeight[];
  /** Remove signers (the master key is ignored; weight it to 0 instead). */
  removeSigners?: AccountId[];
  masterWeight?: number;
  lowThreshold?: number;
  mediumThreshold?: number;
  highThreshold?: number;
}

export interface ThresholdLevels {
  low: number;
  medium: number;
  high: number;
}

/**
 * Unsigned XDR plus the signer set and thresholds the change would leave.
 * The backend refuses lock-outs with 422 `SET_OPTIONS_LOCKOUT`; softer risks
 * come back as `warnings` for the user to confirm.
 */
export interface SetOptionsResult {
  xdr: string;
  networkPassphrase: string;
  warnings: string[];
  resultingSigners: SignerWeight[];
  resultingThresholds: ThresholdLevels;
}

/** POST /wallet/submit: 200 once the network decided. */
export interface SubmitResult {
  hash: string;
  ledger?: number;
  successful: boolean;
}

/** POST /wallet/submit: 202 when Horizon timed out; the transaction may still land. */
export interface SubmitPending {
  hash: string;
  status: "pending";
}

export function isSubmitPending(result: SubmitResult | SubmitPending): result is SubmitPending {
  return "status" in result && result.status === "pending";
}

export function multisigApi(client: ApiClient) {
  return {
    thresholds(publicKey: AccountId, signal?: AbortSignal) {
      return client.get<AccountThresholds>(`/api/v1/wallet/${encodeURIComponent(publicKey)}/thresholds`, { signal });
    },

    buildSetOptions(input: SetOptionsInput) {
      return client.post<SetOptionsResult>("/api/v1/wallet/set-options/build", input);
    },

    /** Submit a client-signed classic envelope; `idempotencyKey` makes retries safe. */
    submit(signedXdr: string, idempotencyKey?: string) {
      return client.post<SubmitResult | SubmitPending>("/api/v1/wallet/submit", {
        signedXdr,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
    },
  };
}

export type MultisigApi = ReturnType<typeof multisigApi>;
