import { hash, Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  KeystoreError,
  assertValidKeyId,
  assertValidPublicKey,
  base64ToBytes,
  bytesEqual,
  bytesToBase64,
  resolveKeyDescriptor,
  type KeyDescriptor,
  type Keystore,
  type SignAuthEntryOptions,
  type SignTransactionOptions,
  type SignedAuthEntryResult,
  type SignedTransactionResult,
} from "./types.js";

/**
 * Transport-agnostic hardware wallet driver interface (e.g. Ledger WebHID/BLE/Speculos).
 */
export interface HardwareWalletDevice {
  readonly id?: string;
  readonly label?: string;
  getPublicKey(derivationPath: string): Promise<string>;
  /** Signs a Stellar XDR envelope on device, returning either signed XDR or a 64-byte signature. */
  signTransaction(
    derivationPath: string,
    xdr: string,
    networkPassphrase: string
  ): Promise<string | Uint8Array>;
  /** Signs a Soroban auth entry preimage on device, returning a base64 or raw 64-byte signature. */
  signAuthEntry?(
    derivationPath: string,
    authEntry: string,
    networkPassphrase?: string
  ): Promise<string | Uint8Array>;
  /** Optional raw 32-byte hash signing (omitted when the device forbids blind signing). */
  signHash?(derivationPath: string, hashBytes: Uint8Array): Promise<Uint8Array>;
}

export interface HardwareWalletAccountConfig {
  id?: string;
  derivationPath: string;
  label?: string;
}

export interface HardwareWalletKeystoreOptions {
  device: HardwareWalletDevice;
  accounts?: readonly HardwareWalletAccountConfig[];
  defaultKeyId?: string;
}

const DEFAULT_DERIVATION_PATH = "44'/148'/0'";

function mapDeviceError(err: unknown, fallbackMessage: string): KeystoreError {
  if (err instanceof KeystoreError) return err;
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  const msg = err instanceof Error ? err.message : fallbackMessage;
  if (code === "USER_REJECTED" || /rejected|denied/i.test(msg)) {
    return new KeystoreError("USER_REJECTED", msg, err);
  }
  if (code === "DEVICE_UNAVAILABLE" || /unavailable|locked|disconnected|not open/i.test(msg)) {
    return new KeystoreError("HARDWARE_UNAVAILABLE", msg, err);
  }
  return new KeystoreError("SIGNING_FAILED", fallbackMessage, err);
}

/**
 * Hardware wallet keystore adapter. Keys never leave the external device;
 * all returned signatures and signed envelopes are verified locally against
 * the device's public key before returning.
 */
export class HardwareWalletKeystore implements Keystore {
  readonly kind = "hardware";
  private readonly device: HardwareWalletDevice;
  private readonly accounts: readonly { id: string; derivationPath: string; label?: string }[];
  private readonly defaultKeyId?: string;
  private readonly publicKeyCache = new Map<string, string>();

  constructor(options: HardwareWalletKeystoreOptions) {
    if (!options?.device) {
      throw new KeystoreError("HARDWARE_UNAVAILABLE", "Hardware wallet device is required");
    }
    this.device = options.device;
    const rawAccounts =
      options.accounts && options.accounts.length > 0
        ? options.accounts
        : [{ derivationPath: DEFAULT_DERIVATION_PATH, label: options.device.label }];
    this.accounts = rawAccounts.map((acc) => ({
      id: assertValidKeyId(acc.id ?? acc.derivationPath.replace(/'/g, "h").replace(/\//g, "_")),
      derivationPath: acc.derivationPath,
      ...(acc.label !== undefined ? { label: acc.label } : {}),
    }));
    this.defaultKeyId = options.defaultKeyId;
  }

  async listKeys(): Promise<readonly KeyDescriptor[]> {
    const out: KeyDescriptor[] = [];
    for (const account of this.accounts) {
      const publicKey = await this.fetchPublicKey(account.id, account.derivationPath);
      out.push({
        id: account.id,
        publicKey,
        algorithm: "ed25519",
        nonExtractable: true,
        ...(account.label !== undefined ? { label: account.label } : {}),
      });
    }
    return out;
  }

  async getPublicKey(keyId?: string): Promise<string> {
    const account = resolveKeyDescriptor(this.accounts, keyId, this.defaultKeyId);
    return this.fetchPublicKey(account.id, account.derivationPath);
  }

  async signPayload(payload: Uint8Array, keyId?: string): Promise<Uint8Array> {
    if (!(payload instanceof Uint8Array)) {
      throw new KeystoreError("SIGNING_FAILED", "Payload must be a Uint8Array");
    }
    if (!this.device.signHash) {
      throw new KeystoreError(
        "SIGNING_FAILED",
        "Hardware device does not support raw payload signing; use signTransaction or signAuthEntry"
      );
    }
    const account = resolveKeyDescriptor(this.accounts, keyId, this.defaultKeyId);
    const publicKey = await this.fetchPublicKey(account.id, account.derivationPath);
    let sig: Uint8Array;
    try {
      sig = await this.device.signHash(account.derivationPath, new Uint8Array(payload));
    } catch (err) {
      throw mapDeviceError(err, "Hardware device failed to sign payload");
    }
    if (!Keypair.fromPublicKey(publicKey).verify(payload, sig)) {
      throw new KeystoreError("SIGNING_FAILED", "Hardware device returned an invalid signature");
    }
    return new Uint8Array(sig);
  }

  async signTransaction(xdr: string, options: SignTransactionOptions): Promise<SignedTransactionResult> {
    if (!options?.networkPassphrase) {
      throw new KeystoreError("SIGNING_FAILED", "networkPassphrase is required to sign a transaction");
    }
    let unsignedTx: ReturnType<typeof TransactionBuilder.fromXdr>;
    try {
      unsignedTx = TransactionBuilder.fromXdr(xdr, options.networkPassphrase);
    } catch (err) {
      throw new KeystoreError("SIGNING_FAILED", "Invalid transaction XDR envelope", err);
    }

    const account = resolveKeyDescriptor(this.accounts, options.keyId, this.defaultKeyId);
    const signerAddress = await this.fetchPublicKey(account.id, account.derivationPath);

    let result: string | Uint8Array;
    try {
      result = await this.device.signTransaction(
        account.derivationPath,
        xdr,
        options.networkPassphrase
      );
    } catch (err) {
      throw mapDeviceError(err, "Hardware device failed to sign transaction");
    }

    if (result instanceof Uint8Array) {
      try {
        unsignedTx.addSignature(signerAddress, bytesToBase64(result));
      } catch (err) {
        throw new KeystoreError("SIGNING_FAILED", "Hardware signature failed verification", err);
      }
      return { signedTxXdr: unsignedTx.toXdr(), signerAddress };
    }

    // Device returned full signed XDR: verify the transaction hash was not altered.
    let signedTx: ReturnType<typeof TransactionBuilder.fromXdr>;
    try {
      signedTx = TransactionBuilder.fromXdr(result, options.networkPassphrase);
    } catch (err) {
      throw new KeystoreError("SIGNING_FAILED", "Hardware device returned invalid signed XDR", err);
    }
    if (!bytesEqual(unsignedTx.hash(), signedTx.hash())) {
      throw new KeystoreError("SIGNING_FAILED", "Hardware device altered transaction envelope hash");
    }
    const kp = Keypair.fromPublicKey(signerAddress);
    const hasValidSig = signedTx.signatures.some((s) =>
      kp.verify(signedTx.hash(), s.signature)
    );
    if (!hasValidSig) {
      throw new KeystoreError("SIGNING_FAILED", "Signed envelope lacks a valid signature for device key");
    }
    return { signedTxXdr: signedTx.toXdr(), signerAddress };
  }

  async signAuthEntry(
    authEntry: string,
    options?: SignAuthEntryOptions
  ): Promise<SignedAuthEntryResult> {
    if (typeof authEntry !== "string" || authEntry.length === 0) {
      throw new KeystoreError("SIGNING_FAILED", "authEntry must be a non-empty base64 XDR string");
    }
    const account = resolveKeyDescriptor(this.accounts, options?.keyId, this.defaultKeyId);
    const signerAddress = await this.fetchPublicKey(account.id, account.derivationPath);
    const digest = hash(base64ToBytes(authEntry));

    let rawSig: Uint8Array;
    try {
      if (this.device.signAuthEntry) {
        const res = await this.device.signAuthEntry(
          account.derivationPath,
          authEntry,
          options?.networkPassphrase
        );
        rawSig = typeof res === "string" ? base64ToBytes(res) : res;
      } else if (this.device.signHash) {
        rawSig = await this.device.signHash(account.derivationPath, digest);
      } else {
        throw new KeystoreError("SIGNING_FAILED", "Hardware device does not support auth entry signing");
      }
    } catch (err) {
      throw mapDeviceError(err, "Hardware device failed to sign auth entry");
    }

    if (!Keypair.fromPublicKey(signerAddress).verify(digest, rawSig)) {
      throw new KeystoreError("SIGNING_FAILED", "Hardware auth entry signature failed verification");
    }
    return { signedAuthEntry: bytesToBase64(rawSig), signerAddress };
  }

  private async fetchPublicKey(id: string, derivationPath: string): Promise<string> {
    const cached = this.publicKeyCache.get(id);
    if (cached) return cached;
    let publicKey: string;
    try {
      publicKey = await this.device.getPublicKey(derivationPath);
    } catch (err) {
      throw mapDeviceError(err, "Failed to read public key from hardware device");
    }
    const validated = assertValidPublicKey(publicKey);
    this.publicKeyCache.set(id, validated);
    return validated;
  }
}
