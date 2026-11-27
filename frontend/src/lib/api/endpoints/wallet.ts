import type { ApiClient } from "../client";
import type { AccountId } from "../types";

/**
 * /api/v1/wallet — non-custodial transaction routes
 * (backend/src/routes/wallet.ts, backend/src/routes/clientSigning.ts).
 *
 * The server builds an unsigned transaction, the wallet signs it and the
 * server submits the signed envelope unchanged (it only relays envelopes it
 * built, so never edit the XDR; wrapping it in a fee-bump is fine). The
 * custodial routes that take a secret key are deliberately not exposed.
 *
 * Every wallet route sits behind `requireAccountMatch()`, which needs the
 * acting account in the body or the query string. Routes whose body has no
 * actor field (submit, paths, payment requests) send it as
 * `?sourcePublicKey=` so the body still passes `rejectUnknownBodyFields`.
 */

/** What every build route returns (services/transactionEnvelope.ts). */
export interface UnsignedTransaction {
  /** Base64 XDR of the unsigned envelope. */
  xdr: string;
  networkPassphrase: string;
  /** Total fee in stroops (base fee x operation count). */
  fee: string;
  sequence: string;
  timeBounds: { minTime: string; maxTime: string };
  /** ISO time the transaction expires, or null if it never does. */
  expiresAt: string | null;
}

export type SendOperationType = "payment" | "createAccount";

/** POST /send/build — `createAccount` when the destination is unfunded. */
export interface PaymentBuild extends UnsignedTransaction {
  operationType: SendOperationType;
}

export interface SendBuildRequest {
  sourcePublicKey: AccountId;
  /** G... or muxed M... address. */
  destinationPublicKey: string;
  amount: string;
  /** "XLM" (default) or "CODE:ISSUER". */
  asset?: string;
  /** MEMO_TEXT only, at most 28 UTF-8 bytes. */
  memo?: string;
}

/** POST /path-payment-strict-send/build and /path-payment-strict-receive/build. */
export interface PathPaymentBuild extends UnsignedTransaction {
  expectedSend: string;
  expectedReceive: string;
  /** Strict-send: the least the destination receives. */
  minReceive?: string;
  /** Strict-receive: the most the source spends. */
  maxSend?: string;
  slippageBps: number;
  path: string[];
}

interface PathPaymentBuildBase {
  sourcePublicKey: AccountId;
  destinationPublicKey: string;
  /** Defaults to XLM. */
  sendAsset?: string;
  destAsset: string;
  /** Intermediate assets as "CODE:ISSUER" (at most 5). */
  path?: string[];
  /** 0..500, default 50. */
  slippageBps?: number;
  memo?: string;
}

export interface StrictSendBuildRequest extends PathPaymentBuildBase {
  sendAmount: string;
  /** Destination amount quoted by /paths/strict-send. */
  quotedDestAmount: string;
}

export interface StrictReceiveBuildRequest extends PathPaymentBuildBase {
  destAmount: string;
  /** Source amount quoted by /paths/strict-receive. */
  quotedSendAmount: string;
}

/** POST /submit — the network accepted the transaction. */
export interface SubmitSuccess {
  hash: string;
  ledger?: number;
  successful: boolean;
}

/** POST /submit answered 202: Horizon timed out, the transaction may still land. */
export interface SubmitPending {
  hash: string;
  status: "pending";
}

export type SubmitResult = SubmitSuccess | SubmitPending;

export function isSubmitPending(result: SubmitResult): result is SubmitPending {
  return "status" in result && result.status === "pending";
}

export interface SubmitOptions {
  /** The signed-in account (the envelope's source or fee source). */
  account: AccountId;
  /** Replays the first result when the same key is sent again. */
  idempotencyKey?: string;
}

const actor = (account: AccountId) => ({ sourcePublicKey: account });

export function walletApi(client: ApiClient) {
  return {
    /** Unsigned payment (or createAccount for an unfunded destination). */
    buildSend(body: SendBuildRequest) {
      return client.post<PaymentBuild>("/api/v1/wallet/send/build", body);
    },

    buildStrictSend(body: StrictSendBuildRequest) {
      return client.post<PathPaymentBuild>("/api/v1/wallet/path-payment-strict-send/build", body);
    },

    buildStrictReceive(body: StrictReceiveBuildRequest) {
      return client.post<PathPaymentBuild>("/api/v1/wallet/path-payment-strict-receive/build", body);
    },

    /** Submit a signed envelope (plain or fee-bump) built by this API. */
    submit(signedXdr: string, { account, idempotencyKey }: SubmitOptions) {
      return client.post<SubmitResult>("/api/v1/wallet/submit", { signedXdr }, {
        query: actor(account),
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      });
    },
  };
}

export type WalletApi = ReturnType<typeof walletApi>;
