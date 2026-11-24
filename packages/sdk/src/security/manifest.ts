/**
 * Signed client configuration (issue #226).
 *
 * Clients read contract ids and network URLs from the API's config /
 * deployment manifest. If that response is tampered with (compromised API,
 * MITM), a client could be pointed at a malicious contract. The manifest is
 * therefore signed with an offline ed25519 release key, and clients verify
 * it against public keys pinned in the app before trusting any field.
 *
 * Several trusted keys may be pinned at once so the release key can be
 * rotated: ship the new public key alongside the old one, start signing
 * with the new key, then drop the old key in a later release.
 */
import { Keypair } from "@stellar/stellar-sdk";

export interface SignedManifest<T = unknown> {
  manifest: T;
  /** Stellar public key (G...) of the key that produced `signature`. */
  publicKey: string;
  /** Base64 ed25519 signature over `canonicalJson(manifest)`. */
  signature: string;
}

export class ManifestVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestVerificationError";
  }
}

/**
 * Deterministic JSON: object keys sorted recursively, no whitespace, so the
 * signer and verifier hash the same bytes regardless of key order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

/** Release tooling: sign a manifest with the offline release key. */
export function signManifest<T>(manifest: T, secretKey: string): SignedManifest<T> {
  const keypair = Keypair.fromSecret(secretKey);
  const signature = keypair.sign(Buffer.from(canonicalJson(manifest), "utf8"));
  // stellar-sdk 17 returns a Uint8Array (not a Buffer) from Keypair#sign.
  return { manifest, publicKey: keypair.publicKey(), signature: Buffer.from(signature).toString("base64") };
}

/**
 * Verify a signed manifest against the pinned release keys and return the
 * manifest. Throws `ManifestVerificationError` if the signing key is not
 * pinned, the signature is malformed, or the manifest was modified.
 */
export function verifySignedManifest<T>(signed: SignedManifest<T>, trustedPublicKeys: readonly string[]): T {
  if (trustedPublicKeys.length === 0) {
    throw new ManifestVerificationError("no trusted manifest keys are pinned");
  }
  if (!signed || typeof signed.signature !== "string" || typeof signed.publicKey !== "string") {
    throw new ManifestVerificationError("manifest is not signed");
  }
  if (!trustedPublicKeys.includes(signed.publicKey)) {
    throw new ManifestVerificationError("manifest signed by an untrusted key");
  }
  let valid = false;
  try {
    valid = Keypair.fromPublicKey(signed.publicKey).verify(
      Buffer.from(canonicalJson(signed.manifest), "utf8"),
      Buffer.from(signed.signature, "base64")
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new ManifestVerificationError("manifest signature is invalid");
  }
  return signed.manifest;
}
