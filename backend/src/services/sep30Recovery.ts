import { randomBytes } from 'crypto';

/**
 * SEP-30 (Account Recovery) client integration.
 *
 * This module talks to a SEP-30 recovery server and exposes a small, typed
 * surface that the existing guardian-based recovery flow can combine with.
 * It intentionally does not replace guardians: callers decide how to merge
 * the two recovery paths.
 *
 * Reference: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0030.md
 */

export interface Sep30AuthToken {
  token: string;
  expiresAt: string;
}

export interface Sep30RecoveryAccount {
  address: string;
  identities: Sep30Identity[];
  signers: Sep30Signer[];
}

export interface Sep30Identity {
  role: string;
  authenticated: boolean;
}

export interface Sep30Signer {
  key: string;
  weight: number;
}

export interface Sep30RegisterRequest {
  address: string;
  identities: Array<{ role: string }>;
  signers: Sep30Signer[];
}

export interface Sep30SignRequest {
  address: string;
  signingAddress: string;
  transaction: string; // base64-encoded XDR
}

export interface Sep30SignResponse {
  transaction: string; // base64-encoded signed XDR
}

export interface Sep30ClientConfig {
  /** Base URL of the SEP-30 recovery server, e.g. https://recovery.example.com */
  serverUrl: string;
  /** Optional fetch implementation (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

export class Sep30Error extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'Sep30Error';
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Minimal SEP-30 client. All privileged calls require a bearer token obtained
 * from the server's SEP-10 authentication flow (handled by the caller).
 */
export class Sep30RecoveryClient {
  private readonly serverUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: Sep30ClientConfig) {
    if (!config.serverUrl) {
      throw new Sep30Error('sep30_invalid_config', 'serverUrl is required', 0);
    }
    this.serverUrl = config.serverUrl.replace(/\/+$/, '');
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Register an account with the recovery server. */
  async registerAccount(
    request: Sep30RegisterRequest,
    auth: Sep30AuthToken,
  ): Promise<Sep30RecoveryAccount> {
    validateAddress(request.address);
    if (!Array.isArray(request.identities) || request.identities.length === 0) {
      throw new Sep30Error('sep30_invalid_request', 'identities are required', 0);
    }
    if (!Array.isArray(request.signers) || request.signers.length === 0) {
      throw new Sep30Error('sep30_invalid_request', 'signers are required', 0);
    }
    return this.request<Sep30RecoveryAccount>('POST', '/accounts', auth, request);
  }

  /** Fetch the recovery account details for an address. */
  async getAccount(address: string, auth: Sep30AuthToken): Promise<Sep30RecoveryAccount> {
    validateAddress(address);
    return this.request<Sep30RecoveryAccount>('GET', `/accounts/${encodeURIComponent(address)}`, auth);
  }

  /** Update the identities/signers registered for an account. */
  async updateAccount(
    address: string,
    request: Partial<Sep30RegisterRequest>,
    auth: Sep30AuthToken,
  ): Promise<Sep30RecoveryAccount> {
    validateAddress(address);
    return this.request<Sep30RecoveryAccount>(
      'PUT',
      `/accounts/${encodeURIComponent(address)}`,
      auth,
      request,
    );
  }

  /** Delete the recovery account registration. */
  async deleteAccount(address: string, auth: Sep30AuthToken): Promise<void> {
    validateAddress(address);
    await this.request<unknown>('DELETE', `/accounts/${encodeURIComponent(address)}`, auth);
  }

  /** Ask the recovery server to co-sign a transaction. */
  async signTransaction(
    request: Sep30SignRequest,
    auth: Sep30AuthToken,
  ): Promise<Sep30SignResponse> {
    validateAddress(request.address);
    validateAddress(request.signingAddress);
    if (!request.transaction) {
      throw new Sep30Error('sep30_invalid_request', 'transaction is required', 0);
    }
    return this.request<Sep30SignResponse>(
      'POST',
      `/accounts/${encodeURIComponent(request.address)}/sign/${encodeURIComponent(
        request.signingAddress,
      )}`,
      auth,
      { transaction: request.transaction },
    );
  }

  private async request<T>(
    method: string,
    path: string,
    auth: Sep30AuthToken,
    body?: unknown,
  ): Promise<T> {
    if (!auth || !auth.token) {
      throw new Sep30Error('sep30_unauthorized', 'missing auth token', 401);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.serverUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'network error';
      throw new Sep30Error('sep30_network_error', message, 0);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let message = `SEP-30 request failed with status ${response.status}`;
      try {
        const payload = (await response.json()) as { error?: string };
        if (payload && typeof payload.error === 'string') {
          message = payload.error;
        }
      } catch {
        // ignore non-JSON error bodies
      }
      throw new Sep30Error('sep30_request_failed', message, response.status);
    }

    if (response.status === 204) {
      return undefined as unknown as T;
    }

    return (await response.json()) as T;
  }
}

/**
 * Generate a random nonce used to correlate an identity verification flow
 * (e.g. email/SMS challenge) with the SEP-30 registration request.
 */
export function createIdentityVerificationNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Combine SEP-30 recovery signers with guardian-based recovery signers.
 *
 * The result is the union of both sets, de-duplicated by key, with the
 * highest weight retained when a key appears in both paths. This lets the
 * existing guardian flow keep working while SEP-30 acts as an alternative
 * recovery path.
 */
export function combineRecoverySigners(
  guardianSigners: Sep30Signer[],
  sep30Signers: Sep30Signer[],
): Sep30Signer[] {
  const merged = new Map<string, Sep30Signer>();

  for (const signer of [...guardianSigners, ...sep30Signers]) {
    if (!signer || typeof signer.key !== 'string' || signer.key.length === 0) {
      continue;
    }
    const existing = merged.get(signer.key);
    if (!existing || signer.weight > existing.weight) {
      merged.set(signer.key, { key: signer.key, weight: signer.weight });
    }
  }

  return Array.from(merged.values());
}

/**
 * Basic Stellar address validation. SEP-30 servers expect a valid account ID;
 * we reject obviously malformed input at the edge before making a request.
 */
export function validateAddress(address: string): void {
  if (typeof address !== 'string' || !/^G[A-Z2-7]{55}$/.test(address)) {
    throw new Sep30Error('sep30_invalid_address', `invalid Stellar address: ${address}`, 0);
  }
}
