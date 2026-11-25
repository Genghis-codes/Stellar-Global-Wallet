import { Keypair, StrKey } from "@stellar/stellar-sdk";
import {
  KeystoreError,
  assertValidKeyId,
  resolveKeyDescriptor,
  signAuthEntryWithPayload,
  signTransactionWithPayload,
  type KeyDescriptor,
  type Keystore,
  type SignAuthEntryOptions,
  type SignTransactionOptions,
  type SignedAuthEntryResult,
  type SignedTransactionResult,
} from "./types.js";

/** Subset of `expo-secure-store` options forwarded to the native Keychain/Keystore. */
export interface ExpoSecureStoreOptions {
  keychainService?: string;
  requireAuthentication?: boolean;
  authenticationPrompt?: string;
  keychainAccessible?: number;
}

/** Structural interface matching `expo-secure-store` so callers inject the module directly. */
export interface ExpoSecureStoreLike {
  getItemAsync(key: string, options?: ExpoSecureStoreOptions): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: ExpoSecureStoreOptions): Promise<void>;
  deleteItemAsync(key: string, options?: ExpoSecureStoreOptions): Promise<void>;
}

export interface ExpoSecureStoreKeystoreOptions {
  store: ExpoSecureStoreLike;
  namespace?: string;
  defaultKeyId?: string;
  storeOptions?: ExpoSecureStoreOptions;
}

/**
 * React Native / Expo SecureStore keystore adapter.
 *
 * Stores secret seeds individually in the OS Keychain/Keystore and maintains
 * a separate public-only descriptor index. Signing instantiates a transient
 * `Keypair` inside `signPayload` without caching secrets in instance state.
 */
export class ExpoSecureStoreKeystore implements Keystore {
  readonly kind = "expo-secure-store";
  private readonly store: ExpoSecureStoreLike;
  private readonly namespace: string;
  private readonly defaultKeyId?: string;
  private readonly storeOptions?: ExpoSecureStoreOptions;

  constructor(options: ExpoSecureStoreKeystoreOptions) {
    if (!options?.store) {
      throw new KeystoreError("UNSUPPORTED_ENVIRONMENT", "Expo SecureStore implementation is required");
    }
    this.store = options.store;
    this.namespace = options.namespace ?? "globe_wallet.keystore";
    this.defaultKeyId = options.defaultKeyId;
    this.storeOptions = options.storeOptions;
  }

  private get indexKey(): string {
    return `${this.namespace}.index`;
  }

  private secretKeyName(id: string): string {
    return `${this.namespace}.key.${id}`;
  }

  /** Generates a random Ed25519 keypair, persists the secret in SecureStore, and returns public metadata. */
  async generateKey(options?: { id?: string; label?: string }): Promise<KeyDescriptor> {
    const keypair = Keypair.random();
    return this.persistKeypair(keypair, options);
  }

  /** Imports a Stellar secret seed (`S...`) into SecureStore and returns public metadata. */
  async importSecretKey(
    secret: string,
    options?: { id?: string; label?: string }
  ): Promise<KeyDescriptor> {
    if (typeof secret !== "string" || !StrKey.isValidEd25519SecretSeed(secret)) {
      throw new KeystoreError("INVALID_KEY_MATERIAL", "Invalid Stellar Ed25519 secret seed");
    }
    const keypair = Keypair.fromSecret(secret);
    return this.persistKeypair(keypair, options);
  }

  async listKeys(): Promise<readonly KeyDescriptor[]> {
    const raw = await this.store.getItemAsync(this.indexKey, this.publicIndexOptions());
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as KeyDescriptor[]) : [];
    } catch (err) {
      throw new KeystoreError("INVALID_KEY_MATERIAL", "Corrupted keystore index", err);
    }
  }

  async getPublicKey(keyId?: string): Promise<string> {
    const keys = await this.listKeys();
    return resolveKeyDescriptor(keys, keyId, this.defaultKeyId).publicKey;
  }

  async signPayload(payload: Uint8Array, keyId?: string): Promise<Uint8Array> {
    if (!(payload instanceof Uint8Array)) {
      throw new KeystoreError("SIGNING_FAILED", "Payload must be a Uint8Array");
    }
    const keys = await this.listKeys();
    const descriptor = resolveKeyDescriptor(keys, keyId, this.defaultKeyId);
    const secret = await this.store.getItemAsync(this.secretKeyName(descriptor.id), this.storeOptions);
    if (!secret) {
      throw new KeystoreError("KEY_NOT_FOUND", `Secret missing in SecureStore for key: ${descriptor.id}`);
    }
    if (!StrKey.isValidEd25519SecretSeed(secret)) {
      throw new KeystoreError("INVALID_KEY_MATERIAL", "Stored secret is not a valid Stellar seed");
    }
    const seed = StrKey.decodeEd25519SecretSeed(secret);
    try {
      const keypair = Keypair.fromRawEd25519Seed(seed);
      return new Uint8Array(keypair.sign(payload));
    } catch (err) {
      throw new KeystoreError("SIGNING_FAILED", "SecureStore signing failed", err);
    } finally {
      seed.fill(0);
    }
  }

  signTransaction(xdr: string, options: SignTransactionOptions): Promise<SignedTransactionResult> {
    return signTransactionWithPayload(this, xdr, options);
  }

  signAuthEntry(authEntry: string, options?: SignAuthEntryOptions): Promise<SignedAuthEntryResult> {
    return signAuthEntryWithPayload(this, authEntry, options);
  }

  async deleteKey(keyId: string): Promise<void> {
    const id = assertValidKeyId(keyId);
    const keys = await this.listKeys();
    const next = keys.filter((k) => k.id !== id);
    if (next.length === keys.length) {
      throw new KeystoreError("KEY_NOT_FOUND", `Key not found in keystore: ${id}`);
    }
    await this.store.deleteItemAsync(this.secretKeyName(id), this.storeOptions);
    await this.store.setItemAsync(this.indexKey, JSON.stringify(next), this.publicIndexOptions());
  }

  private publicIndexOptions(): ExpoSecureStoreOptions | undefined {
    if (!this.storeOptions) return undefined;
    // Public descriptors do not require biometric unlock just to list accounts.
    const { requireAuthentication: _omit, authenticationPrompt: _omitPrompt, ...rest } =
      this.storeOptions;
    return Object.keys(rest).length > 0 ? rest : undefined;
  }

  private async persistKeypair(
    keypair: Keypair,
    options?: { id?: string; label?: string }
  ): Promise<KeyDescriptor> {
    const publicKey = keypair.publicKey();
    const id = assertValidKeyId(options?.id ?? publicKey);
    const keys = await this.listKeys();
    if (keys.some((k) => k.id === id)) {
      throw new KeystoreError("KEY_ALREADY_EXISTS", `Key already exists in keystore: ${id}`);
    }

    const descriptor: KeyDescriptor = {
      id,
      publicKey,
      algorithm: "ed25519",
      nonExtractable: true,
      ...(options?.label !== undefined ? { label: options.label } : {}),
    };

    await this.store.setItemAsync(this.secretKeyName(id), keypair.secret(), this.storeOptions);
    await this.store.setItemAsync(
      this.indexKey,
      JSON.stringify([...keys, descriptor]),
      this.publicIndexOptions()
    );
    return descriptor;
  }
}
