/**
 * SDK key management abstraction with pluggable non-exportable storage
 * adapters and biometric gating hooks (#295).
 */
export {
  KeystoreError,
  toStellarSigner,
} from "./types.js";
export type {
  KeyAlgorithm,
  KeyDescriptor,
  Keystore,
  KeystoreErrorCode,
  SignAuthEntryOptions,
  SignTransactionOptions,
  SignedAuthEntryResult,
  SignedTransactionResult,
} from "./types.js";

export {
  BiometricGatedKeystore,
  withBiometricGate,
} from "./biometric.js";
export type {
  BiometricGate,
  BiometricGateOptions,
  BiometricGateResult,
  BiometricOperation,
  BiometricPromptContext,
} from "./biometric.js";

export {
  WebCryptoKeystore,
  createIndexedDbKeyStorage,
} from "./webcrypto.js";
export type {
  WebCryptoKeyRecord,
  WebCryptoKeyStorage,
  WebCryptoKeystoreOptions,
} from "./webcrypto.js";

export { ExpoSecureStoreKeystore } from "./expo.js";
export type {
  ExpoSecureStoreKeystoreOptions,
  ExpoSecureStoreLike,
  ExpoSecureStoreOptions,
} from "./expo.js";

export { HardwareWalletKeystore } from "./hardware.js";
export type {
  HardwareWalletAccountConfig,
  HardwareWalletDevice,
  HardwareWalletKeystoreOptions,
} from "./hardware.js";
