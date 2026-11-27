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

/** One pre-signing warning from POST /send/precheck (#64). */
export interface SendPrecheckWarning {
  code:
    | "DESTINATION_IS_SOURCE"
    | "SOURCE_NOT_FUNDED"
    | "DESTINATION_NOT_FUNDED"
    | "DESTINATION_WILL_BE_CREATED"
    | "NO_TRUSTLINE"
    | "TRUSTLINE_NOT_AUTHORIZED"
    | "MEMO_REQUIRED"
    | "AMOUNT_EXCEEDS_SPENDABLE";
  message: string;
  /** Submitting as-is would certainly fail or lose funds. */
  blocking: boolean;
}

export interface SendPrecheckResult {
  warnings: SendPrecheckWarning[];
  /** Any warning is blocking: don't offer "Sign". */
  blocking: boolean;
  operationType: SendOperationType;
  /** Source's spendable balance of the asset; absent when the source is unfunded. */
  spendable?: string;
}

export interface SendPrecheckRequest {
  sourcePublicKey: AccountId;
  /** G... only: pass the base account of a muxed destination. */
  destinationPublicKey: AccountId;
  amount: string;
  asset?: string;
  memo?: string;
}

type HorizonAssetType = "native" | "credit_alphanum4" | "credit_alphanum12";

/** One intermediate asset of a path (Horizon shape). */
export interface PathAssetHop {
  asset_type: HorizonAssetType;
  asset_code?: string;
  asset_issuer?: string;
}

/** A Horizon path record relayed by /paths/strict-send and /paths/strict-receive (at most 5). */
export interface PaymentPath {
  source_asset_type: HorizonAssetType;
  source_asset_code?: string;
  source_asset_issuer?: string;
  source_amount: string;
  destination_asset_type: HorizonAssetType;
  destination_asset_code?: string;
  destination_asset_issuer?: string;
  destination_amount: string;
  path: PathAssetHop[];
}

export interface StrictSendPathsRequest {
  sourceAmount: string;
  /** Defaults to XLM. */
  sourceAsset?: string;
  destinationAsset: string;
}

export interface StrictReceivePathsRequest {
  destinationAmount: string;
  destinationAsset: string;
  /** Defaults to XLM. */
  sourceAsset?: string;
}

/** SEP-7 `pay` fields, snake_case as the backend sends them. */
export interface Sep7PayFields {
  destination: string;
  amount?: string;
  asset_code?: string;
  asset_issuer?: string;
  memo?: string;
  memo_type?: string;
  origin_domain?: string;
  signature?: string;
}

/** POST /payment-requests body; `destination` must be a G... account. */
export interface PaymentRequestInput {
  destination: AccountId;
  amount?: string;
  /** Omit (or "XLM") for native; issued assets need asset_issuer too. */
  asset_code?: string;
  asset_issuer?: string;
  memo?: string;
  memo_type?: "MEMO_TEXT" | "MEMO_ID" | "MEMO_HASH" | "MEMO_RETURN";
  origin_domain?: string;
}

/** POST /payment-requests/parse — the fields plus anything wrong with them. */
export interface ParsedPaymentRequest {
  fields: Sep7PayFields;
  warnings: string[];
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

    /**
     * Read-only pre-signing checks: every reason the send would fail or lose
     * funds, as warnings. Always 200 for a well-formed request.
     */
    precheck(body: SendPrecheckRequest) {
      return client.post<SendPrecheckResult>("/api/v1/wallet/send/precheck", body);
    },

    /**
     * Routes that turn exactly `sourceAmount` of the source asset into the
     * destination asset. (`destinationPublicKey` is not sent: the backend
     * would then search every asset that account holds.)
     */
    async strictSendPaths(account: AccountId, body: StrictSendPathsRequest, signal?: AbortSignal) {
      const { paths } = await client.post<{ paths: PaymentPath[] }>("/api/v1/wallet/paths/strict-send", body, {
        query: actor(account),
        signal,
      });
      return paths;
    },

    /** Routes that deliver exactly `destinationAmount` of the destination asset. */
    async strictReceivePaths(account: AccountId, body: StrictReceivePathsRequest, signal?: AbortSignal) {
      const { paths } = await client.post<{ paths: PaymentPath[] }>("/api/v1/wallet/paths/strict-receive", body, {
        query: actor(account),
        signal,
      });
      return paths;
    },

    /** Build a SEP-7 `web+stellar:pay?...` URI. */
    createPaymentRequest(account: AccountId, body: PaymentRequestInput) {
      return client.post<{ uri: string }>("/api/v1/wallet/payment-requests", body, { query: actor(account) });
    },

    /** Parse and sanity-check a SEP-7 pay URI (throws a 400 ApiError when it isn't one). */
    parsePaymentRequest(account: AccountId, uri: string) {
      return client.post<ParsedPaymentRequest>("/api/v1/wallet/payment-requests/parse", { uri }, { query: actor(account) });
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
