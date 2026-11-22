import * as StellarSdk from "@stellar/stellar-sdk";
import { InvalidTransactionError, TransactionExpiredError } from "./stellarErrors";

/**
 * How long an unsigned transaction stays valid. Long enough for a user to
 * review it and approve the wallet prompt, short enough that an abandoned
 * XDR can't be submitted later.
 */
export const BUILD_TIMEOUT_SECONDS = 180;

/**
 * What a build endpoint returns for a transaction the client is about to
 * sign: the unsigned envelope plus everything a wallet UI needs to show
 * before asking for a signature (network, fee, expiry).
 */
export interface UnsignedTransactionInfo {
  /** Base64 XDR of the unsigned transaction envelope. */
  xdr: string;
  /** Passphrase the wallet must sign against — must match the API's network. */
  networkPassphrase: string;
  /** Total fee in stroops (base fee x operation count). */
  fee: string;
  /** Sequence number the transaction uses. Not reserved: two builds in a row share it. */
  sequence: string;
  /** Unix seconds as strings; `maxTime` of "0" means no expiry. */
  timeBounds: { minTime: string; maxTime: string };
  /** ISO timestamp of `timeBounds.maxTime`, or null when the transaction never expires. */
  expiresAt: string | null;
}

export function describeUnsignedTransaction(
  tx: StellarSdk.Transaction,
  networkPassphrase: string
): UnsignedTransactionInfo {
  const timeBounds = { minTime: tx.timeBounds?.minTime ?? "0", maxTime: tx.timeBounds?.maxTime ?? "0" };
  return {
    xdr: tx.toXDR(),
    networkPassphrase,
    fee: tx.fee,
    sequence: tx.sequence,
    timeBounds,
    expiresAt: timeBounds.maxTime === "0" ? null : new Date(Number(timeBounds.maxTime) * 1000).toISOString(),
  };
}

/**
 * The underlying G... account of a G... or muxed M... address. Existence,
 * trustline and SEP-29 checks run against the base account; the muxed ID
 * only matters in the operation's destination field.
 */
export function baseAccountId(address: string): string {
  return address.startsWith("M")
    ? StellarSdk.MuxedAccount.fromAddress(address, "0").baseAccount().accountId()
    : address;
}

/** A submitted transaction the network accepted. */
export interface SubmitSignedResult {
  hash: string;
  ledger: number;
  successful: boolean;
}

/**
 * The network didn't answer in time (Horizon 504, or Soroban RPC still
 * reporting NOT_FOUND). The transaction may yet land, so the client should
 * poll for `hash` rather than rebuild.
 */
export interface SubmitSignedPending {
  hash: string;
  status: "pending";
}

export type AnyTransaction = StellarSdk.Transaction | StellarSdk.FeeBumpTransaction;

export interface ParsedSignedTransaction {
  transaction: AnyTransaction;
  /** Hex transaction hash (of the fee-bump envelope when there is one). */
  hash: string;
  /** G... account whose sequence number is consumed — scopes idempotency keys. */
  sourcePublicKey: string;
}

function innerTransaction(tx: AnyTransaction): StellarSdk.Transaction {
  return "innerTransaction" in tx ? tx.innerTransaction : tx;
}

/**
 * Rejects an envelope whose signature from `signerAddress` doesn't verify
 * under the API's network passphrase. The passphrase is hashed into what is
 * signed, so an envelope signed for another network (testnet vs public)
 * parses fine here but fails this check. Only signatures whose hint matches
 * the signer are checked: other co-signers' keys aren't known without
 * loading the account, so those are left for Horizon to judge.
 */
export function assertSignedForThisNetwork(tx: AnyTransaction, signerAddress: string): void {
  const signer = StellarSdk.Keypair.fromPublicKey(baseAccountId(signerAddress));
  const hint = Buffer.from(signer.signatureHint());
  const candidates = tx.signatures.filter((sig) => Buffer.from(sig.hint()).equals(hint));
  if (candidates.length === 0) return;

  const hash = tx.hash();
  if (!candidates.some((sig) => signer.verify(hash, sig.signature()))) {
    throw new InvalidTransactionError(
      "The signature does not verify for this network. The transaction was signed for a different " +
        "network passphrase than the one this API uses.",
      "WRONG_NETWORK"
    );
  }
}

/**
 * End-to-end multi-network safety verification (#223).
 * Asserts that the envelope's source and fee-bump feeSource signatures match
 * the expected network passphrase.
 */
export function verifyEnvelopeNetwork(tx: AnyTransaction, networkPassphrase?: string): void {
  const inner = innerTransaction(tx);
  if ("innerTransaction" in tx) {
    assertSignedForThisNetwork(tx, tx.feeSource);
  }
  assertSignedForThisNetwork(inner, inner.source);
}

/**
 * Parses a client-signed envelope and rejects it if it can't be valid:
 * malformed XDR, no signatures (a fee-bump needs both its own and the inner
 * transaction's), or signed for a different network. Does not check expiry —
 * see {@link assertNotExpired}, which callers run after any idempotent replay.
 */
export function parseSignedTransaction(signedXdr: string, networkPassphrase: string): ParsedSignedTransaction {
  let transaction: AnyTransaction;
  try {
    transaction = StellarSdk.TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  } catch {
    throw new InvalidTransactionError("signedXdr is not a valid transaction envelope.", "MALFORMED_XDR");
  }

  const inner = innerTransaction(transaction);
  if (transaction.signatures.length === 0 || inner.signatures.length === 0) {
    throw new InvalidTransactionError("The transaction has not been signed.", "UNSIGNED");
  }

  if ("innerTransaction" in transaction) {
    assertSignedForThisNetwork(transaction, transaction.feeSource);
  }
  assertSignedForThisNetwork(inner, inner.source);

  return {
    transaction,
    hash: transaction.hash().toString("hex"),
    sourcePublicKey: baseAccountId(inner.source),
  };
}

/** Fails fast with TX_EXPIRED when `timeBounds.maxTime` is already in the past. */
export function assertNotExpired(tx: AnyTransaction, now: number = Date.now()): void {
  const maxTime = innerTransaction(tx).timeBounds?.maxTime ?? "0";
  if (maxTime !== "0" && Number(maxTime) * 1000 <= now) {
    const expiredAt = new Date(Number(maxTime) * 1000).toISOString();
    throw new TransactionExpiredError(
      `The transaction expired at ${expiredAt}. Build a new one and sign it again.`,
      expiredAt
    );
  }
}

/**
 * A single human-readable intent decoded from a transaction envelope. The
 * wallet UI renders these before asking for a signature so users never sign
 * XDR they can't inspect (#272).
 */
export type TransactionIntentKind =
  | "payment"
  | "createAccount"
  | "accountMerge"
  | "trustline"
  | "signerChange"
  | "allowanceApproval"
  | "contractCall"
  | "invokeHostFunction"
  | "other";

export interface TransactionIntent {
  kind: TransactionIntentKind;
  /** Short human-readable summary, e.g. "Send 10 XLM to G...". */
  summary: string;
  /** Structured fields for the UI; amounts are always strings. */
  details: Record<string, string>;
  /** Risky patterns a user should be warned about before signing. */
  risks: TransactionRisk[];
}

export type TransactionRiskCode =
  | "SIGNER_CHANGE"
  | "ALLOWANCE_APPROVAL"
  | "UNKNOWN_CONTRACT"
  | "ACCOUNT_MERGE";

export interface TransactionRisk {
  code: TransactionRiskCode;
  message: string;
}

export interface TransactionPreview {
  /** Hex transaction hash of the envelope being previewed. */
  hash: string;
  /** G... source account whose sequence number is consumed. */
  sourcePublicKey: string;
  /** Total fee in stroops. */
  fee: string;
  /** Ordered intents, one per operation. */
  intents: TransactionIntent[];
  /** Union of all risks across intents, de-duplicated by code. */
  risks: TransactionRisk[];
}

/**
 * Contracts the wallet recognises as safe to call. Anything else is flagged
 * as an unknown contract so the user can decide whether to trust it.
 */
export const KNOWN_CONTRACT_IDS: ReadonlySet<string> = new Set<string>();

function assetLabel(asset: StellarSdk.Asset): string {
  return asset.isNative() ? "XLM" : `${asset.getCode()}:${asset.getIssuer()}`;
}

function decodeOperation(op: StellarSdk.xdr.Operation, knownContracts: ReadonlySet<string>): TransactionIntent {
  const body = op.body();
  const type = body.switch().name;

  if (type === "payment") {
    const payment = body.paymentOp();
    const asset = StellarSdk.Asset.fromOperation(op).asset;
    const amount = StellarSdk.Operation.fromXDRObject(op).amount ?? "0";
    const destination = StellarSdk.StrKey.encodeEd25519PublicKey(payment.destination().ed25519());
    return {
      kind: "payment",
      summary: `Send ${amount} ${assetLabel(asset)} to ${destination}`,
      details: { destination, amount, asset: assetLabel(asset) },
      risks: [],
    };
  }

  if (type === "createAccount") {
    const create = body.createAccountOp();
    const destination = StellarSdk.StrKey.encodeEd25519PublicKey(create.destination().ed25519());
    const startingBalance = StellarSdk.Operation.fromXDRObject(op).startingBalance ?? "0";
    return {
      kind: "createAccount",
      summary: `Create account ${destination} with ${startingBalance} XLM`,
      details: { destination, startingBalance },
      risks: [],
    };
  }

  if (type === "accountMerge") {
    const destination = StellarSdk.StrKey.encodeEd25519PublicKey(body.destination().ed25519());
    return {
      kind: "accountMerge",
      summary: `Merge this account into ${destination}`,
      details: { destination },
      risks: [{ code: "ACCOUNT_MERGE", message: "This operation transfers the entire account balance and closes the account." }],
    };
  }

  if (type === "changeTrust") {
    const change = body.changeTrustOp();
    const asset = StellarSdk.Asset.fromOperation(op).line;
    const limit = StellarSdk.Operation.fromXDRObject(op).limit ?? "0";
    const label = assetLabel(asset);
    return {
      kind: "trustline",
      summary: limit === "0" ? `Remove trustline for ${label}` : `Trust ${label} up to ${limit}`,
      details: { asset: label, limit },
      risks: [],
    };
  }

  if (type === "setOptions") {
    const setOptions = StellarSdk.Operation.fromXDRObject(op);
    const details: Record<string, string> = {};
    if (setOptions.signer) {
      details.signerKey = setOptions.signer.ed25519PublicKey ?? setOptions.signer.preAuthTx ?? "";
      details.signerWeight = String(setOptions.signer.weight);
    }
    if (setOptions.masterWeight !== undefined) details.masterWeight = String(setOptions.masterWeight);
    if (setOptions.lowThreshold !== undefined) details.lowThreshold = String(setOptions.lowThreshold);
    if (setOptions.medThreshold !== undefined) details.medThreshold = String(setOptions.medThreshold);
    if (setOptions.highThreshold !== undefined) details.highThreshold = String(setOptions.highThreshold);
    const risks: TransactionRisk[] = [];
    if (setOptions.signer || setOptions.masterWeight !== undefined) {
      risks.push({ code: "SIGNER_CHANGE", message: "This operation changes who can sign for the account." });
    }
    return {
      kind: "signerChange",
      summary: setOptions.signer ? `Add or update signer ${details.signerKey}` : "Change account signing options",
      details,
      risks,
    };
  }

  if (type === "invokeHostFunction") {
    const invoke = body.invokeHostFunctionOp();
    const hostFunction = invoke.hostFunction();
    const fnType = hostFunction.switch().name;
    const details: Record<string, string> = { hostFunction: fnType };
    const risks: TransactionRisk[] = [];

    if (fnType === "hostFunctionTypeInvokeContract") {
      const invocation = hostFunction.invokeContract();
      const contractId = StellarSdk.StrKey.encodeContract(invocation.contractAddress().contractId());
      const functionName = invocation.functionName().toString();
      details.contractId = contractId;
      details.function = functionName;
      if (!knownContracts.has(contractId)) {
        risks.push({ code: "UNKNOWN_CONTRACT", message: `Contract ${contractId} is not in the wallet's known-contract list.` });
      }
      if (/approve|allowance/i.test(functionName)) {
        risks.push({ code: "ALLOWANCE_APPROVAL", message: "This call appears to approve an allowance that lets another party spend your tokens." });
      }
      return {
        kind: "contractCall",
        summary: `Call ${functionName} on contract ${contractId}`,
        details,
        risks,
      };
    }

    return {
      kind: "invokeHostFunction",
      summary: `Invoke Soroban host function ${fnType}`,
      details,
      risks,
    };
  }

  return {
    kind: "other",
    summary: `Operation ${type}`,
    details: { operationType: type },
    risks: [],
  };
}

/**
 * Decodes a transaction envelope into structured, human-readable intents and
 * flags risky patterns before the user signs (#272). Accepts a base64 XDR
 * string or an already-parsed transaction.
 */
export function previewTransaction(
  input: string | AnyTransaction,
  networkPassphrase: string,
  knownContracts: ReadonlySet<string> = KNOWN_CONTRACT_IDS
): TransactionPreview {
  let transaction: AnyTransaction;
  if (typeof input === "string") {
    try {
      transaction = StellarSdk.TransactionBuilder.fromXDR(input, networkPassphrase);
    } catch {
      throw new InvalidTransactionError("xdr is not a valid transaction envelope.", "MALFORMED_XDR");
    }
  } else {
    transaction = input;
  }

  const inner = innerTransaction(transaction);
  const intents = inner.operations.map((op) => decodeOperation(op, knownContracts));

  const seen = new Set<TransactionRiskCode>();
  const risks: TransactionRisk[] = [];
  for (const intent of intents) {
    for (const risk of intent.risks) {
      if (!seen.has(risk.code)) {
        seen.add(risk.code);
        risks.push(risk);
      }
    }
  }

  return {
    hash: transaction.hash().toString("hex"),
    sourcePublicKey: baseAccountId(inner.source),
    fee: inner.fee,
    intents,
    risks,
  };
}
