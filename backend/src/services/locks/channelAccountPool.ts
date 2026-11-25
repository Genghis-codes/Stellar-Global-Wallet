/**
 * Channel-account pool for sponsored submissions.
 *
 * Each in-flight submission leases one channel account and builds its inner
 * transaction on that account's sequence number, so up to N transactions can
 * land per ledger instead of serialising on a single source account. The
 * treasury pays fees by wrapping the inner transaction in a fee-bump, so
 * channel accounts never need to spend their own XLM on fees.
 *
 * Leasing is in-process by default; pass a RedisChannelLease to share leases
 * across instances. When every channel is busy the caller gets `null` and
 * falls back to the legacy single-source path (serialised, still correct),
 * as documented next to CHANNEL_POOL_ENABLED in config.ts.
 */
import * as StellarSdk from "@stellar/stellar-sdk";
import { randomUUID } from "crypto";
import type { RedisChannelLease } from "./redisAccountLock";

export interface ChannelAccount {
  publicKey: string;
  keypair: StellarSdk.Keypair;
}

export interface ChannelAccountPoolOptions {
  enabled: boolean;
  channelSecrets: string[];
  treasurySecret?: string;
  networkPassphrase: string;
  /** Shared lease backend; omitted = in-process leases. */
  lease?: Pick<RedisChannelLease, "tryAcquire" | "tryRelease">;
  /** Fee per operation (stroops) offered by the treasury fee-bump. */
  feeBumpBaseFee?: string;
}

export class ChannelAccountPool {
  private readonly channels: ChannelAccount[];
  private readonly treasury: StellarSdk.Keypair | null;
  private readonly localLeases = new Set<string>();
  private next = 0;

  constructor(private readonly options: ChannelAccountPoolOptions) {
    this.channels = options.channelSecrets.map((secret) => {
      const keypair = StellarSdk.Keypair.fromSecret(secret);
      return { publicKey: keypair.publicKey(), keypair };
    });
    this.treasury = options.treasurySecret
      ? StellarSdk.Keypair.fromSecret(options.treasurySecret)
      : null;
  }

  /** The pool is usable only with channels and a treasury to pay fee-bumps. */
  isEnabled(): boolean {
    return this.options.enabled && this.channels.length > 0 && this.treasury !== null;
  }

  get size(): number {
    return this.channels.length;
  }

  /**
   * Runs `fn` with a leased channel, releasing it afterwards even if `fn`
   * throws. Passes `null` when no channel is free so the caller can use the
   * single-source path.
   */
  async withChannelLease<T>(fn: (channel: ChannelAccount | null) => Promise<T>): Promise<T> {
    const leased = await this.acquire();
    if (!leased) return fn(null);
    try {
      return await fn(leased.channel);
    } finally {
      await this.release(leased.channel, leased.token);
    }
  }

  /** Wraps a channel-built inner transaction in a treasury-signed fee-bump. */
  buildFeeBump(innerTx: StellarSdk.Transaction): StellarSdk.FeeBumpTransaction {
    if (!this.treasury) {
      throw new Error("Channel pool has no treasury key for fee-bumps");
    }
    const feeBump = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
      this.treasury,
      this.options.feeBumpBaseFee ?? String(Number(StellarSdk.BASE_FEE) * 10),
      innerTx,
      this.options.networkPassphrase
    );
    feeBump.sign(this.treasury);
    return feeBump;
  }

  private async acquire(): Promise<{ channel: ChannelAccount; token: string } | null> {
    // Round-robin start so load spreads across channels.
    for (let i = 0; i < this.channels.length; i++) {
      const channel = this.channels[(this.next + i) % this.channels.length];
      if (this.localLeases.has(channel.publicKey)) continue;
      const token = randomUUID();
      if (this.options.lease) {
        let fence: number | null;
        try {
          fence = await this.options.lease.tryAcquire(channel.publicKey, token);
        } catch {
          // Shared lease store unavailable: fall back to the serialised path
          // rather than risk two instances sharing a channel sequence.
          return null;
        }
        if (fence === null) continue;
      }
      this.localLeases.add(channel.publicKey);
      this.next = (this.next + i + 1) % this.channels.length;
      return { channel, token };
    }
    return null;
  }

  private async release(channel: ChannelAccount, token: string): Promise<void> {
    this.localLeases.delete(channel.publicKey);
    if (this.options.lease) {
      try {
        await this.options.lease.tryRelease(channel.publicKey, token);
      } catch (err) {
        // The lease TTL reclaims it; never fail a finished submission.
        console.error("[channel-pool] lease release failed", (err as Error).message);
      }
    }
  }
}
