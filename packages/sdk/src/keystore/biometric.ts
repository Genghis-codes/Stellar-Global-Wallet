import {
  KeystoreError,
  type KeyDescriptor,
  type Keystore,
  type SignAuthEntryOptions,
  type SignTransactionOptions,
  type SignedAuthEntryResult,
  type SignedTransactionResult,
} from "./types.js";

export type BiometricOperation = "signTransaction" | "signAuthEntry" | "signPayload" | "deleteKey";

export interface BiometricPromptContext {
  operation: BiometricOperation;
  keyId?: string;
  networkPassphrase?: string;
  reason?: string;
}

export interface BiometricGateResult {
  verified: boolean;
  reason?: "cancelled" | "failed" | "unavailable" | string;
}

/**
 * Platform hook for gating keystore operations behind biometric or user
 * presence verification (e.g. FaceID/TouchID, Android BiometricPrompt, WebAuthn).
 */
export interface BiometricGate {
  isAvailable?(): Promise<boolean>;
  authenticate(context: BiometricPromptContext): Promise<BiometricGateResult | boolean>;
  onAuthorized?(context: BiometricPromptContext): Promise<void> | void;
  onDenied?(context: BiometricPromptContext, error: KeystoreError): Promise<void> | void;
}

export interface BiometricGateOptions {
  /** Operations requiring biometric confirmation. Defaults to all signing and delete operations. */
  operations?: readonly BiometricOperation[];
  /** Optional grace period (ms) after a successful prompt; defaults to 0 (prompt every time). */
  unlockWindowMs?: number;
  /** Prompt message or formatter passed to `gate.authenticate`. */
  reason?: string | ((context: BiometricPromptContext) => string);
}

const DEFAULT_GATED_OPERATIONS: readonly BiometricOperation[] = [
  "signTransaction",
  "signAuthEntry",
  "signPayload",
  "deleteKey",
];

/**
 * Wraps any `Keystore` with fail-closed biometric gating hooks.
 *
 * Biometric verification runs before `signTransaction`, `signAuthEntry`,
 * `signPayload`, or `deleteKey` reaches the underlying keystore.
 */
export class BiometricGatedKeystore implements Keystore {
  readonly kind: string;
  private readonly gatedOperations: Set<BiometricOperation>;
  private readonly unlockWindowMs: number;
  private unlockedUntil = 0;

  constructor(
    private readonly inner: Keystore,
    private readonly gate: BiometricGate,
    private readonly options: BiometricGateOptions = {}
  ) {
    this.kind = `biometric:${inner.kind}`;
    this.gatedOperations = new Set(options.operations ?? DEFAULT_GATED_OPERATIONS);
    this.unlockWindowMs = Math.max(0, options.unlockWindowMs ?? 0);
  }

  /** Clears any active unlock window so the next gated operation re-prompts. */
  lock(): void {
    this.unlockedUntil = 0;
  }

  listKeys(): Promise<readonly KeyDescriptor[]> {
    return this.inner.listKeys();
  }

  getPublicKey(keyId?: string): Promise<string> {
    return this.inner.getPublicKey(keyId);
  }

  signPayload(payload: Uint8Array, keyId?: string): Promise<Uint8Array> {
    return this.authorize("signPayload", keyId, undefined, () =>
      this.inner.signPayload(payload, keyId)
    );
  }

  signTransaction(xdr: string, options: SignTransactionOptions): Promise<SignedTransactionResult> {
    return this.authorize("signTransaction", options.keyId, options.networkPassphrase, () =>
      this.inner.signTransaction(xdr, options)
    );
  }

  signAuthEntry(
    authEntry: string,
    options?: SignAuthEntryOptions
  ): Promise<SignedAuthEntryResult> {
    return this.authorize("signAuthEntry", options?.keyId, options?.networkPassphrase, () =>
      this.inner.signAuthEntry(authEntry, options)
    );
  }

  async deleteKey(keyId: string): Promise<void> {
    if (!this.inner.deleteKey) {
      throw new KeystoreError("UNSUPPORTED_ENVIRONMENT", "Underlying keystore does not support deleteKey");
    }
    const del = this.inner.deleteKey.bind(this.inner);
    return this.authorize("deleteKey", keyId, undefined, () => del(keyId));
  }

  private async authorize<T>(
    operation: BiometricOperation,
    keyId: string | undefined,
    networkPassphrase: string | undefined,
    action: () => Promise<T>
  ): Promise<T> {
    if (!this.gatedOperations.has(operation)) {
      return action();
    }

    const baseContext: BiometricPromptContext = { operation, keyId, networkPassphrase };
    const reason =
      typeof this.options.reason === "function"
        ? this.options.reason(baseContext)
        : this.options.reason;
    const context: BiometricPromptContext = reason !== undefined ? { ...baseContext, reason } : baseContext;

    if (this.unlockWindowMs === 0 || Date.now() >= this.unlockedUntil) {
      await this.verifyBiometric(context);
      if (this.unlockWindowMs > 0) {
        this.unlockedUntil = Date.now() + this.unlockWindowMs;
      }
    }

    const result = await action();
    await this.gate.onAuthorized?.(context);
    return result;
  }

  private async verifyBiometric(context: BiometricPromptContext): Promise<void> {
    try {
      if (this.gate.isAvailable) {
        const available = await this.gate.isAvailable();
        if (!available) {
          throw new KeystoreError("BIOMETRIC_REQUIRED", "Biometric authentication is unavailable");
        }
      }

      const outcome = await this.gate.authenticate(context);
      const verified = typeof outcome === "boolean" ? outcome : outcome.verified;
      if (!verified) {
        const reason = typeof outcome === "object" && outcome !== null ? outcome.reason : undefined;
        const code =
          reason === "cancelled"
            ? "BIOMETRIC_CANCELLED"
            : reason === "unavailable"
              ? "BIOMETRIC_REQUIRED"
              : "BIOMETRIC_FAILED";
        throw new KeystoreError(code, `Biometric verification denied (${reason ?? "failed"})`);
      }
    } catch (err) {
      const keystoreErr =
        err instanceof KeystoreError
          ? err
          : new KeystoreError("BIOMETRIC_FAILED", "Biometric verification failed", err);
      await this.gate.onDenied?.(context, keystoreErr);
      throw keystoreErr;
    }
  }
}

/** Wraps `keystore` with biometric gating hooks. */
export function withBiometricGate(
  keystore: Keystore,
  gate: BiometricGate,
  options?: BiometricGateOptions
): BiometricGatedKeystore {
  return new BiometricGatedKeystore(keystore, gate, options);
}
