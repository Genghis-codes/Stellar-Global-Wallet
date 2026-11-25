import { hash, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import type { SignAuthEntry, Signer, SignTransaction } from "@stellar/stellar-sdk/contract";

export type KeyAlgorithm = "ed25519";

export interface KeyDescriptor {
  /** Stable identifier within the keystore (defaults to Stellar publicKey or alias). */
  readonly id: string;
  /** Stellar Ed25519 public key (`G...`). */
  readonly publicKey: string;
  readonly algorithm: KeyAlgorithm;
  /** True when the underlying key material cannot be exported from the backing store. */
  readonly nonExtractable: boolean;
  /** Optional human-readable label or derivation path metadata. */
  readonly label?: string;
}

export interface SignTransactionOptions {
  networkPassphrase: string;
  keyId?: string;
}

export interface SignAuthEntryOptions {
  networkPassphrase?: string;
  keyId?: string;
}

export interface SignedTransactionResult {
  signedTxXdr: string;
  signerAddress: string;
}

export interface SignedAuthEntryResult {
  signedAuthEntry: string;
  signerAddress: string;
}

export type KeystoreErrorCode =
  | "KEY_NOT_FOUND"
  | "KEY_ALREADY_EXISTS"
  | "INVALID_KEY_MATERIAL"
  | "UNSUPPORTED_ENVIRONMENT"
  | "BIOMETRIC_REQUIRED"
  | "BIOMETRIC_FAILED"
  | "BIOMETRIC_CANCELLED"
  | "HARDWARE_UNAVAILABLE"
  | "USER_REJECTED"
  | "SIGNING_FAILED";

/** Typed error thrown by keystore adapters and biometric gates. */
export class KeystoreError extends Error {
  constructor(
    readonly code: KeystoreErrorCode,
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "KeystoreError";
  }
}

/**
 * Pluggable non-exportable signing abstraction.
 *
 * Implementations hold or delegate to key material in WebCrypto/IndexedDB,
 * Expo SecureStore, or hardware wallets without ever exposing private keys.
 */
export interface Keystore {
  readonly kind: string;
  listKeys(): Promise<readonly KeyDescriptor[]>;
  getPublicKey(keyId?: string): Promise<string>;
  signPayload(payload: Uint8Array, keyId?: string): Promise<Uint8Array>;
  signTransaction(xdr: string, options: SignTransactionOptions): Promise<SignedTransactionResult>;
  signAuthEntry(authEntry: string, options?: SignAuthEntryOptions): Promise<SignedAuthEntryResult>;
  deleteKey?(keyId: string): Promise<void>;
}

const SAFE_KEY_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/** Validates a key identifier so it cannot collide with storage metadata keys. */
export function assertValidKeyId(keyId: string): string {
  if (typeof keyId !== "string" || !SAFE_KEY_ID_RE.test(keyId)) {
    throw new KeystoreError(
      "INVALID_KEY_MATERIAL",
      "Key id must be 1-128 characters matching [A-Za-z0-9._:-]"
    );
  }
  return keyId;
}

/** Validates a Stellar Ed25519 `G...` public key. */
export function assertValidPublicKey(publicKey: string): string {
  if (typeof publicKey !== "string" || !StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new KeystoreError("INVALID_KEY_MATERIAL", "Invalid Stellar Ed25519 public key");
  }
  return publicKey;
}

/** Resolves a single target descriptor by explicit `keyId`, `defaultKeyId`, or sole key. */
export function resolveKeyDescriptor<T extends { id: string }>(
  keys: readonly T[],
  keyId?: string,
  defaultKeyId?: string
): T {
  const targetId = keyId ?? defaultKeyId;
  if (targetId !== undefined) {
    const match = keys.find((k) => k.id === targetId);
    if (!match) {
      throw new KeystoreError("KEY_NOT_FOUND", `Key not found in keystore: ${targetId}`);
    }
    return match;
  }
  if (keys.length === 0) {
    throw new KeystoreError("KEY_NOT_FOUND", "Keystore contains no keys");
  }
  if (keys.length > 1) {
    throw new KeystoreError(
      "KEY_NOT_FOUND",
      "Keystore contains multiple keys; specify keyId or defaultKeyId"
    );
  }
  return keys[0];
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(base64);
  } catch (err) {
    throw new KeystoreError("INVALID_KEY_MATERIAL", "Invalid base64 payload", err);
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Shared Stellar transaction envelope signing helper for payload-signing adapters.
 * Parses the envelope, signs `tx.hash()`, and verifies/attaches the signature.
 */
export async function signTransactionWithPayload(
  keystore: Pick<Keystore, "getPublicKey" | "signPayload">,
  xdr: string,
  options: SignTransactionOptions
): Promise<SignedTransactionResult> {
  if (!options?.networkPassphrase) {
    throw new KeystoreError("SIGNING_FAILED", "networkPassphrase is required to sign a transaction");
  }
  let tx: ReturnType<typeof TransactionBuilder.fromXdr>;
  try {
    tx = TransactionBuilder.fromXdr(xdr, options.networkPassphrase);
  } catch (err) {
    throw new KeystoreError("SIGNING_FAILED", "Invalid transaction XDR envelope", err);
  }

  const signerAddress = await keystore.getPublicKey(options.keyId);
  const signature = await keystore.signPayload(tx.hash(), options.keyId);
  try {
    tx.addSignature(signerAddress, bytesToBase64(signature));
  } catch (err) {
    throw new KeystoreError("SIGNING_FAILED", "Generated signature failed envelope verification", err);
  }
  return { signedTxXdr: tx.toXdr(), signerAddress };
}

/**
 * Shared Soroban auth entry signing helper for payload-signing adapters.
 * Signs SHA-256 of the base64-decoded auth entry preimage.
 */
export async function signAuthEntryWithPayload(
  keystore: Pick<Keystore, "getPublicKey" | "signPayload">,
  authEntry: string,
  options?: SignAuthEntryOptions
): Promise<SignedAuthEntryResult> {
  if (typeof authEntry !== "string" || authEntry.length === 0) {
    throw new KeystoreError("SIGNING_FAILED", "authEntry must be a non-empty base64 XDR string");
  }
  const preimage = base64ToBytes(authEntry);
  const signerAddress = await keystore.getPublicKey(options?.keyId);
  const signature = await keystore.signPayload(hash(preimage), options?.keyId);
  return { signedAuthEntry: bytesToBase64(signature), signerAddress };
}

/**
 * Bridges a `Keystore` into a `@stellar/stellar-sdk/contract` `Signer` so it
 * can be passed directly to `createGlobeWalletClient` / `GlobeWalletClient`.
 */
export async function toStellarSigner(
  keystore: Keystore,
  options?: { keyId?: string; networkPassphrase?: string }
): Promise<Signer> {
  const address = await keystore.getPublicKey(options?.keyId);
  const signTransaction: SignTransaction = async (xdr, opts) => {
    const networkPassphrase = opts?.networkPassphrase ?? options?.networkPassphrase;
    if (!networkPassphrase) {
      throw new KeystoreError("SIGNING_FAILED", "networkPassphrase is required to sign a transaction");
    }
    return keystore.signTransaction(xdr, { networkPassphrase, keyId: options?.keyId });
  };
  const signAuthEntry: SignAuthEntry = async (authEntry, opts) => {
    return keystore.signAuthEntry(authEntry, {
      networkPassphrase: opts?.networkPassphrase ?? options?.networkPassphrase,
      keyId: options?.keyId,
    });
  };
  return { address, signTransaction, signAuthEntry };
}
