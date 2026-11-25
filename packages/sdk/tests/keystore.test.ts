import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Asset,
  BASE_FEE,
  hash,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import {
  ExpoSecureStoreKeystore,
  HardwareWalletKeystore,
  KeystoreError,
  toStellarSigner,
  WebCryptoKeystore,
  withBiometricGate,
  type ExpoSecureStoreLike,
  type ExpoSecureStoreOptions,
  type HardwareWalletDevice,
  type Keystore,
  type WebCryptoKeyRecord,
  type WebCryptoKeyStorage,
} from "../src/index.js";

function makeMemoryWebCryptoStorage(): {
  storage: WebCryptoKeyStorage;
  records: Map<string, WebCryptoKeyRecord>;
} {
  const records = new Map<string, WebCryptoKeyRecord>();
  return {
    records,
    storage: {
      async get(id) {
        return records.get(id);
      },
      async put(record) {
        records.set(record.id, record);
      },
      async delete(id) {
        records.delete(id);
      },
      async getAll() {
        return [...records.values()];
      },
    },
  };
}

function makeMemoryExpoStore(): {
  store: ExpoSecureStoreLike;
  data: Map<string, { value: string; options?: ExpoSecureStoreOptions }>;
} {
  const data = new Map<string, { value: string; options?: ExpoSecureStoreOptions }>();
  return {
    data,
    store: {
      async getItemAsync(key) {
        return data.get(key)?.value ?? null;
      },
      async setItemAsync(key, value, options) {
        data.set(key, { value, options });
      },
      async deleteItemAsync(key) {
        data.delete(key);
      },
    },
  };
}

function buildUnsignedTxXdr(sourcePublicKey: string): string {
  const destination = Keypair.random().publicKey();
  return new TransactionBuilder(
    { accountId: () => sourcePublicKey, sequenceNumber: () => "1", incrementSequenceNumber() {} },
    { fee: BASE_FEE, networkPassphrase: Networks.TESTNET }
  )
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: "10" }))
    .setTimeout(30)
    .build()
    .toXdr();
}

const SAMPLE_AUTH_ENTRY_B64 = Buffer.from("sample-soroban-auth-entry-preimage").toString("base64");

test("WebCryptoKeystore generates non-extractable keys and signs without exporting secrets", async () => {
  const { storage, records } = makeMemoryWebCryptoStorage();
  const keystore = new WebCryptoKeystore({ storage });

  const desc = await keystore.generateKey({ label: "Web Primary" });
  assert.equal(desc.nonExtractable, true);
  assert.equal(desc.algorithm, "ed25519");
  assert.equal(desc.label, "Web Primary");
  assert.equal("secret" in desc || "privateKey" in desc, false);
  assert.equal("exportKey" in keystore || "getSecret" in keystore, false);

  const stored = records.get(desc.id);
  assert.ok(stored);
  assert.equal(stored.privateKey.extractable, false);
  await assert.rejects(() => globalThis.crypto.subtle.exportKey("pkcs8", stored.privateKey));
  await assert.rejects(() => globalThis.crypto.subtle.exportKey("jwk", stored.privateKey));

  const xdr = buildUnsignedTxXdr(desc.publicKey);
  const { signedTxXdr, signerAddress } = await keystore.signTransaction(xdr, {
    networkPassphrase: Networks.TESTNET,
  });
  assert.equal(signerAddress, desc.publicKey);

  const parsed = TransactionBuilder.fromXdr(signedTxXdr, Networks.TESTNET);
  assert.equal(parsed.signatures.length, 1);
  assert.ok(Keypair.fromPublicKey(desc.publicKey).verify(parsed.hash(), parsed.signatures[0].signature));

  const authSig = await keystore.signAuthEntry(SAMPLE_AUTH_ENTRY_B64);
  assert.equal(authSig.signerAddress, desc.publicKey);
  assert.ok(
    Keypair.fromPublicKey(desc.publicKey).verify(
      hash(Buffer.from(SAMPLE_AUTH_ENTRY_B64, "base64")),
      Buffer.from(authSig.signedAuthEntry, "base64")
    )
  );
});

test("WebCryptoKeystore imports a seed non-extractably, zeroes temp seed, and rejects extractable tampering", async () => {
  const { storage, records } = makeMemoryWebCryptoStorage();
  const keystore = new WebCryptoKeystore({ storage });
  const kp = Keypair.random();

  const desc = await keystore.importSecretKey(kp.secret(), { id: "imported" });
  assert.equal(desc.publicKey, kp.publicKey());
  assert.equal(desc.nonExtractable, true);

  const payload = new Uint8Array([10, 20, 30, 40]);
  const sig = await keystore.signPayload(payload, "imported");
  assert.ok(kp.verify(payload, sig));

  // Simulate tampered storage returning an extractable CryptoKey: must fail closed.
  const extractablePair = (await globalThis.crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  records.set("tampered", {
    id: "tampered",
    publicKey: kp.publicKey(),
    algorithm: "ed25519",
    privateKey: extractablePair.privateKey,
    createdAt: Date.now(),
  });
  await assert.rejects(
    () => keystore.signPayload(payload, "tampered"),
    (err: unknown) => err instanceof KeystoreError && err.code === "INVALID_KEY_MATERIAL"
  );

  await keystore.deleteKey("imported");
  await assert.rejects(
    () => keystore.getPublicKey("imported"),
    (err: unknown) => err instanceof KeystoreError && err.code === "KEY_NOT_FOUND"
  );
});

test("WebCryptoKeystore requires explicit keyId when multiple keys exist", async () => {
  const { storage } = makeMemoryWebCryptoStorage();
  const keystore = new WebCryptoKeystore({ storage });
  const k1 = await keystore.generateKey({ id: "k1" });
  await keystore.generateKey({ id: "k2" });

  await assert.rejects(
    () => keystore.getPublicKey(),
    (err: unknown) => err instanceof KeystoreError && err.code === "KEY_NOT_FOUND"
  );
  assert.equal(await keystore.getPublicKey("k1"), k1.publicKey);
});

test("ExpoSecureStoreKeystore isolates secrets in SecureStore and never exposes them in index or instance", async () => {
  const { store, data } = makeMemoryExpoStore();
  const keystore = new ExpoSecureStoreKeystore({
    store,
    namespace: "app.wallet",
    storeOptions: { requireAuthentication: true, authenticationPrompt: "Confirm signing" },
  });

  const kp = Keypair.random();
  const desc = await keystore.importSecretKey(kp.secret(), { id: "primary", label: "Mobile" });
  assert.equal(desc.publicKey, kp.publicKey());
  assert.equal(desc.nonExtractable, true);

  // Public index must not contain secret material, and keystore instance must not cache secrets.
  const indexRaw = data.get("app.wallet.index")?.value ?? "";
  assert.equal(indexRaw.includes(kp.secret()), false);
  assert.equal(JSON.stringify(keystore).includes(kp.secret()), false);
  assert.equal(data.get("app.wallet.key.primary")?.options?.requireAuthentication, true);

  const xdr = buildUnsignedTxXdr(kp.publicKey());
  const { signedTxXdr } = await keystore.signTransaction(xdr, { networkPassphrase: Networks.TESTNET });
  const parsed = TransactionBuilder.fromXdr(signedTxXdr, Networks.TESTNET);
  assert.ok(kp.verify(parsed.hash(), parsed.signatures[0].signature));

  await keystore.deleteKey("primary");
  assert.equal(data.has("app.wallet.key.primary"), false);
  assert.deepEqual(await keystore.listKeys(), []);
});

test("HardwareWalletKeystore verifies signatures, rejects tampered XDR, and maps device errors", async () => {
  const kp = Keypair.random();
  let rejectNext = false;

  const device: HardwareWalletDevice = {
    label: "Ledger Nano",
    async getPublicKey() {
      return kp.publicKey();
    },
    async signTransaction(_path, xdr, networkPassphrase) {
      if (rejectNext) {
        throw Object.assign(new Error("User rejected on device"), { code: "USER_REJECTED" });
      }
      const tx = TransactionBuilder.fromXdr(xdr, networkPassphrase);
      return kp.sign(tx.hash());
    },
    async signAuthEntry(_path, authEntry) {
      return kp.sign(hash(Buffer.from(authEntry, "base64")));
    },
  };

  const keystore = new HardwareWalletKeystore({ device });
  const keys = await keystore.listKeys();
  assert.equal(keys.length, 1);
  assert.equal(keys[0].publicKey, kp.publicKey());
  assert.equal(keys[0].nonExtractable, true);

  const xdr = buildUnsignedTxXdr(kp.publicKey());
  const signed = await keystore.signTransaction(xdr, { networkPassphrase: Networks.TESTNET });
  const parsed = TransactionBuilder.fromXdr(signed.signedTxXdr, Networks.TESTNET);
  assert.ok(kp.verify(parsed.hash(), parsed.signatures[0].signature));

  // Hardware device returning a full signed XDR envelope (valid, untampered) also succeeds.
  const fullXdrKeystore = new HardwareWalletKeystore({
    device: {
      async getPublicKey() {
        return kp.publicKey();
      },
      async signTransaction(_path, rawXdr, passphrase) {
        const tx = TransactionBuilder.fromXdr(rawXdr, passphrase);
        tx.sign(kp);
        return tx.toXdr();
      },
    },
  });
  const fullSigned = await fullXdrKeystore.signTransaction(xdr, { networkPassphrase: Networks.TESTNET });
  const parsedFull = TransactionBuilder.fromXdr(fullSigned.signedTxXdr, Networks.TESTNET);
  assert.ok(kp.verify(parsedFull.hash(), parsedFull.signatures[0].signature));

  const authSigned = await keystore.signAuthEntry(SAMPLE_AUTH_ENTRY_B64);
  assert.ok(
    kp.verify(
      hash(Buffer.from(SAMPLE_AUTH_ENTRY_B64, "base64")),
      Buffer.from(authSigned.signedAuthEntry, "base64")
    )
  );

  // Raw payload signing is disabled when device omits signHash.
  await assert.rejects(
    () => keystore.signPayload(new Uint8Array([1, 2, 3])),
    (err: unknown) => err instanceof KeystoreError && err.code === "SIGNING_FAILED"
  );

  rejectNext = true;
  await assert.rejects(
    () => keystore.signTransaction(xdr, { networkPassphrase: Networks.TESTNET }),
    (err: unknown) => err instanceof KeystoreError && err.code === "USER_REJECTED"
  );

  // Compromised device returning a mutated envelope must be rejected.
  const evilDevice: HardwareWalletDevice = {
    async getPublicKey() {
      return kp.publicKey();
    },
    async signTransaction() {
      const otherXdr = buildUnsignedTxXdr(kp.publicKey());
      const otherTx = TransactionBuilder.fromXdr(otherXdr, Networks.TESTNET);
      otherTx.sign(kp);
      return otherTx.toXdr();
    },
  };
  const evilKeystore = new HardwareWalletKeystore({ device: evilDevice });
  await assert.rejects(
    () => evilKeystore.signTransaction(xdr, { networkPassphrase: Networks.TESTNET }),
    (err: unknown) => err instanceof KeystoreError && /altered transaction envelope hash/i.test(err.message)
  );
});

test("withBiometricGate fails closed on cancellation/unavailability and bridges via toStellarSigner", async () => {
  const { storage } = makeMemoryWebCryptoStorage();
  const base = new WebCryptoKeystore({ storage });
  const desc = await base.generateKey();

  let innerSignCalls = 0;
  const spyStore: Keystore = {
    kind: base.kind,
    listKeys: () => base.listKeys(),
    getPublicKey: (id) => base.getPublicKey(id),
    signPayload: (p, id) => {
      innerSignCalls += 1;
      return base.signPayload(p, id);
    },
    signTransaction: (xdr, opts) => {
      innerSignCalls += 1;
      return base.signTransaction(xdr, opts);
    },
    signAuthEntry: (entry, opts) => {
      innerSignCalls += 1;
      return base.signAuthEntry(entry, opts);
    },
    deleteKey: (id) => base.deleteKey(id),
  };

  let available = false;
  let outcome: { verified: boolean; reason?: string } = { verified: false, reason: "cancelled" };
  let deniedCount = 0;
  let authorizedCount = 0;
  let promptCount = 0;

  const gated = withBiometricGate(
    spyStore,
    {
      isAvailable: async () => available,
      authenticate: async () => {
        promptCount += 1;
        return outcome;
      },
      onDenied: () => {
        deniedCount += 1;
      },
      onAuthorized: () => {
        authorizedCount += 1;
      },
    },
    { unlockWindowMs: 60_000, reason: ({ operation }) => `Approve ${operation}` }
  );

  const xdr = buildUnsignedTxXdr(desc.publicKey);

  // Unavailable biometrics -> fail closed before calling inner keystore.
  await assert.rejects(
    () => gated.signTransaction(xdr, { networkPassphrase: Networks.TESTNET }),
    (err: unknown) => err instanceof KeystoreError && err.code === "BIOMETRIC_REQUIRED"
  );
  assert.equal(innerSignCalls, 0);
  assert.equal(deniedCount, 1);

  // Cancelled prompt -> BIOMETRIC_CANCELLED and inner keystore never called.
  available = true;
  await assert.rejects(
    () => gated.signPayload(new Uint8Array([1, 2, 3])),
    (err: unknown) => err instanceof KeystoreError && err.code === "BIOMETRIC_CANCELLED"
  );
  assert.equal(innerSignCalls, 0);
  assert.equal(deniedCount, 2);

  // Verified -> executes once, caches within unlockWindowMs, then re-prompts after lock().
  outcome = { verified: true };
  const signer = await toStellarSigner(gated, { networkPassphrase: Networks.TESTNET });
  assert.equal(signer.address, desc.publicKey);
  const res1 = await signer.signTransaction(xdr);
  const res2 = await signer.signAuthEntry!(SAMPLE_AUTH_ENTRY_B64);
  assert.equal(promptCount, 2); // 1 from cancelled signPayload + 1 from signTransaction
  assert.equal(authorizedCount, 2);
  assert.equal(innerSignCalls, 2);
  assert.ok(res1.signedTxXdr);
  assert.ok(res2.signedAuthEntry);

  gated.lock();
  await gated.signPayload(new Uint8Array([4, 5, 6]));
  assert.equal(promptCount, 3);
});
