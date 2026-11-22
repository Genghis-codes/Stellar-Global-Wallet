# Security Model

This document describes the security properties of the backend and the
client-side guarantees it relies on. It is the design note for encrypted key
backup (issue #274) and the threat model that surrounds it.

## Scope

The backend is a **zero-knowledge blob store** for encrypted key backups. It
never sees plaintext secrets, passphrases, or derived keys. All cryptography
happens on the client.

## Encrypted key backup

### Data model

A backup blob is an opaque, client-encrypted payload. The server stores:

| Field        | Type   | Notes                                                        |
| ------------ | ------ | ------------------------------------------------------------ |
| `id`         | string | Server-assigned identifier.                                  |
| `owner`      | string | Authenticated account that owns the blob.                    |
| `ciphertext` | string | Base64 client ciphertext. Opaque to the server.              |
| `nonce`      | string | Base64 nonce/IV chosen by the client.                        |
| `kdf`        | object | Public KDF parameters (algorithm, salt, memory, iterations).  |
| `version`    | number | Envelope version for forward compatibility.                  |
| `createdAt`  | string | ISO-8601 timestamp.                                          |
| `updatedAt`  | string | ISO-8601 timestamp.                                          |

The server validates shape and size at the edge (base64, max length, known
`kdf.algorithm`, positive integer cost parameters) and rejects anything else
with the shared error envelope and a stable error code
(`BACKUP_INVALID_PAYLOAD`, `BACKUP_TOO_LARGE`, `BACKUP_NOT_FOUND`,
`BACKUP_FORBIDDEN`, `BACKUP_RATE_LIMITED`).

### Client-side encryption spec

1. The client derives a symmetric key from the user's passphrase using
   **Argon2id** with a per-backup random salt and conservative cost parameters
   (memory >= 64 MiB, iterations >= 3, parallelism >= 1). Alternatively, a
   passkey **PRF** extension output may be used directly as key material.
2. The derived key wraps the wallet secret with an authenticated cipher
   (AEAD, e.g. XChaCha20-Poly1305 or AES-256-GCM) using a fresh random nonce.
3. The client uploads only `ciphertext`, `nonce`, and the public `kdf`
   parameters. The passphrase and derived key never leave the device.
4. On recovery, the client fetches the blob, re-derives the key from the
   passphrase (or passkey PRF), and decrypts locally. A failed AEAD tag means a
   wrong passphrase or tampered ciphertext; the client surfaces a generic error
   and never retries with server-held material.

### Recovery flow

1. User authenticates to the backend.
2. Client requests the backup blob for the authenticated account.
3. Client re-derives the wrapping key from the passphrase or passkey PRF.
4. Client decrypts locally and restores the secret.
5. If decryption fails, the client reports a wrong-passphrase error; the server
   is never asked to decrypt or validate plaintext.

### Threat model

| Threat                                   | Mitigation                                                        |
| ---------------------------------------- | ----------------------------------------------------------------- |
| Server compromise / DB leak              | Only ciphertext, nonce, and public KDF params are stored.         |
| Malicious insider at the server          | Cannot derive keys without the user's passphrase or passkey.      |
| Network eavesdropping                    | TLS in transit; payload is already ciphertext at rest.            |
| Offline brute force of a stolen blob     | Argon2id with high memory/time cost; strong passphrase required.  |
| Tampering with stored ciphertext         | AEAD authentication tag rejects modified ciphertext.              |
| Cross-account access                     | Auth required; blobs are scoped to the authenticated owner.       |
| Abuse / enumeration                      | Per-account and per-IP rate limiting on the blob endpoints.       |

**Out of scope:** a compromised client device, a weak user passphrase, and
loss of the passphrase/passkey (which makes the backup unrecoverable by
design).

### Failure modes

- **Wrong passphrase:** AEAD tag mismatch; client shows a generic error.
- **Missing blob:** `BACKUP_NOT_FOUND`; client prompts the user to restore from
  a seed phrase instead.
- **Oversized or malformed payload:** rejected at the edge with
  `BACKUP_INVALID_PAYLOAD` / `BACKUP_TOO_LARGE`.
- **Rate limited:** `BACKUP_RATE_LIMITED`; client backs off and retries.

## Tests

The backup test suite includes a negative test asserting that a server-side
compromise (reading the stored blob) yields only ciphertext and public KDF
parameters, never plaintext or derived keys.
