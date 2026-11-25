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

/** Persisted IndexedDB record holding a non-extractable WebCrypto handle. */
export interface WebCryptoKeyRecord {
  readonly id: string;
  readonly publicKey: string;
  readonly algorithm: "ed25519";
  readonly privateKey: CryptoKey;
  readonly label?: string;
  readonly createdAt: number;
}

/** Storage backend for `WebCryptoKeystore` (defaults to browser IndexedDB). */
export interface WebCryptoKeyStorage {
  get(id: string): Promise<WebCryptoKeyRecord | undefined>;
  put(record: WebCryptoKeyRecord): Promise<void>;
  delete(id: string): Promise<void>;
  getAll(): Promise<readonly WebCryptoKeyRecord[]>;
}

export interface WebCryptoKeystoreOptions {
  dbName?: string;
  storeName?: string;
  defaultKeyId?: string;
  storage?: WebCryptoKeyStorage;
  subtle?: SubtleCrypto;
  idbFactory?: IDBFactory;
}

// ASN.1 PKCS#8 header for a 32-byte Ed25519 private seed (RFC 8410).
const ED25519_PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Creates an IndexedDB-backed `WebCryptoKeyStorage` using structured cloning of `CryptoKey`. */
export function createIndexedDbKeyStorage(
  dbName = "globe-wallet-keystore",
  storeName = "keys",
  idbFactory?: IDBFactory
): WebCryptoKeyStorage {
  const factory =
    idbFactory ?? (typeof globalThis !== "undefined" ? globalThis.indexedDB : undefined);

  const openDb = (): Promise<IDBDatabase> => {
    if (!factory) {
      return Promise.reject(
        new KeystoreError("UNSUPPORTED_ENVIRONMENT", "IndexedDB is not available in this environment")
      );
    }
    return new Promise((resolve, reject) => {
      const req = factory.open(dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(new KeystoreError("UNSUPPORTED_ENVIRONMENT", "Failed to open IndexedDB keystore", req.error));
    });
  };

  const withStore = async <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> => {
    const db = await openDb();
    try {
      const tx = db.transaction(storeName, mode);
      const result = await idbRequest(run(tx.objectStore(storeName)));
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return result;
    } finally {
      db.close();
    }
  };

  return {
    get: (id) => withStore("readonly", (s) => s.get(id) as IDBRequest<WebCryptoKeyRecord | undefined>),
    put: async (record) => {
      await withStore("readwrite", (s) => s.put(record));
    },
    delete: async (id) => {
      await withStore("readwrite", (s) => s.delete(id));
    },
    getAll: () => withStore("readonly", (s) => s.getAll() as IDBRequest<WebCryptoKeyRecord[]>),
  };
}

function toDescriptor(record: WebCryptoKeyRecord): KeyDescriptor {
  return {
    id: record.id,
    publicKey: record.publicKey,
    algorithm: record.algorithm,
    nonExtractable: !record.privateKey.extractable,
    ...(record.label !== undefined ? { label: record.label } : {}),
  };
}

/**
 * Browser/WebCrypto keystore backed by non-extractable Ed25519 `CryptoKey`
 * handles persisted in IndexedDB. Private key bytes never leave WebCrypto.
 */
export class WebCryptoKeystore implements Keystore {
  readonly kind = "webcrypto";
  private readonly storage: WebCryptoKeyStorage;
  private readonly subtleOverride?: SubtleCrypto;
  private readonly defaultKeyId?: string;

  constructor(options: WebCryptoKeystoreOptions = {}) {
    this.storage =
      options.storage ??
      createIndexedDbKeyStorage(options.dbName, options.storeName, options.idbFactory);
    this.subtleOverride = options.subtle;
    this.defaultKeyId = options.defaultKeyId;
  }

  private getSubtle(): SubtleCrypto {
    const subtle =
      this.subtleOverride ??
      (typeof globalThis !== "undefined" ? globalThis.crypto?.subtle : undefined);
    if (!subtle) {
      throw new KeystoreError("UNSUPPORTED_ENVIRONMENT", "WebCrypto SubtleCrypto is unavailable");
    }
    return subtle;
  }

  /** Generates a non-extractable Ed25519 keypair inside WebCrypto and persists the handle. */
  async generateKey(options?: { id?: string; label?: string }): Promise<KeyDescriptor> {
    const subtle = this.getSubtle();
    let generated: CryptoKeyPair;
    try {
      generated = (await subtle.generateKey({ name: "Ed25519" }, false, [
        "sign",
        "verify",
      ])) as CryptoKeyPair;
    } catch (err) {
      throw new KeystoreError("UNSUPPORTED_ENVIRONMENT", "WebCrypto Ed25519 key generation failed", err);
    }

    if (generated.privateKey.extractable) {
      throw new KeystoreError("INVALID_KEY_MATERIAL", "Generated private key must be non-extractable");
    }

    const rawPublicKey = new Uint8Array(await subtle.exportKey("raw", generated.publicKey));
    const publicKey = StrKey.encodeEd25519PublicKey(rawPublicKey);
    const id = assertValidKeyId(options?.id ?? publicKey);

    if (await this.storage.get(id)) {
      throw new KeystoreError("KEY_ALREADY_EXISTS", `Key already exists in keystore: ${id}`);
    }

    const record: WebCryptoKeyRecord = {
      id,
      publicKey,
      algorithm: "ed25519",
      privateKey: generated.privateKey,
      ...(options?.label !== undefined ? { label: options.label } : {}),
      createdAt: Date.now(),
    };
    await this.storage.put(record);
    return toDescriptor(record);
  }

  /**
   * Imports a Stellar secret seed (`S...` or 32-byte raw seed) as a
   * non-extractable `CryptoKey` and immediately zeroes temporary buffers.
   */
  async importSecretKey(
    secret: string | Uint8Array,
    options?: { id?: string; label?: string }
  ): Promise<KeyDescriptor> {
    const subtle = this.getSubtle();
    let seed: Uint8Array;
    try {
      seed =
        typeof secret === "string"
          ? StrKey.decodeEd25519SecretSeed(secret)
          : new Uint8Array(secret);
    } catch (err) {
      throw new KeystoreError("INVALID_KEY_MATERIAL", "Invalid Stellar Ed25519 secret seed", err);
    }

    if (seed.length !== 32) {
      seed.fill(0);
      throw new KeystoreError("INVALID_KEY_MATERIAL", "Ed25519 seed must be 32 bytes");
    }

    const pkcs8 = new Uint8Array(ED25519_PKCS8_PREFIX.length + 32);
    try {
      pkcs8.set(ED25519_PKCS8_PREFIX, 0);
      pkcs8.set(seed, ED25519_PKCS8_PREFIX.length);

      const publicKey = Keypair.fromRawEd25519Seed(seed).publicKey();
      const id = assertValidKeyId(options?.id ?? publicKey);
      if (await this.storage.get(id)) {
        throw new KeystoreError("KEY_ALREADY_EXISTS", `Key already exists in keystore: ${id}`);
      }

      const privateKey = await subtle.importKey(
        "pkcs8",
        pkcs8,
        { name: "Ed25519" },
        false,
        ["sign"]
      );
      if (privateKey.extractable) {
        throw new KeystoreError("INVALID_KEY_MATERIAL", "Imported private key must be non-extractable");
      }

      const record: WebCryptoKeyRecord = {
        id,
        publicKey,
        algorithm: "ed25519",
        privateKey,
        ...(options?.label !== undefined ? { label: options.label } : {}),
        createdAt: Date.now(),
      };
      await this.storage.put(record);
      return toDescriptor(record);
    } catch (err) {
      if (err instanceof KeystoreError) throw err;
      throw new KeystoreError("INVALID_KEY_MATERIAL", "Failed to import Ed25519 seed into WebCrypto", err);
    } finally {
      seed.fill(0);
      pkcs8.fill(0);
    }
  }

  async listKeys(): Promise<readonly KeyDescriptor[]> {
    const records = await this.storage.getAll();
    return records.map(toDescriptor);
  }

  async getPublicKey(keyId?: string): Promise<string> {
    const record = await this.resolveRecord(keyId);
    return record.publicKey;
  }

  async signPayload(payload: Uint8Array, keyId?: string): Promise<Uint8Array> {
    if (!(payload instanceof Uint8Array)) {
      throw new KeystoreError("SIGNING_FAILED", "Payload must be a Uint8Array");
    }
    const record = await this.resolveRecord(keyId);
    if (record.privateKey.extractable) {
      throw new KeystoreError("INVALID_KEY_MATERIAL", "Refusing to sign with an extractable key");
    }
    const subtle = this.getSubtle();
    const copy = new Uint8Array(payload);
    try {
      const signature = await subtle.sign("Ed25519", record.privateKey, copy);
      return new Uint8Array(signature);
    } catch (err) {
      throw new KeystoreError("SIGNING_FAILED", "WebCrypto signing failed", err);
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
    const existing = await this.storage.get(id);
    if (!existing) {
      throw new KeystoreError("KEY_NOT_FOUND", `Key not found in keystore: ${id}`);
    }
    await this.storage.delete(id);
  }

  private async resolveRecord(keyId?: string): Promise<WebCryptoKeyRecord> {
    const targetId = keyId ?? this.defaultKeyId;
    if (targetId !== undefined) {
      const record = await this.storage.get(assertValidKeyId(targetId));
      if (!record) {
        throw new KeystoreError("KEY_NOT_FOUND", `Key not found in keystore: ${targetId}`);
      }
      return record;
    }
    const all = await this.storage.getAll();
    return resolveKeyDescriptor(all, keyId, this.defaultKeyId);
  }
}
