/**
 * TTL keeper job (#185).
 *
 * Soroban archives persistent entries whose TTL runs out. The contract
 * already extends entries on every write and fails closed when a limit is
 * missing (`SpendLimitArchived`), but an inactive wallet would still end up
 * blocked until someone pays for a restore. This job keeps active wallets
 * alive proactively:
 *
 *   1. list active wallets (devices seen in the last TTL_KEEPER_ACTIVE_DAYS);
 *   2. read the TTL of each wallet's `UserAssets`, `SpendLimit(code)` and
 *      `LimitOptIn(code)` entries via getLedgerEntries;
 *   3. alert when the shortest remaining TTL drops under
 *      TTL_KEEPER_ALERT_LEDGERS, and call the permissionless
 *      `extend_user_ttl(user)` once it drops under EXTEND_BELOW_LEDGERS
 *      (the contract's own 7-day threshold). `SorobanService.invoke`
 *      restores any already-archived footprint automatically first.
 *
 * Failure modes: an RPC error for one wallet is alerted and the sweep moves
 * on; the next sweep retries. The fee-payer key has no authority over any
 * wallet — `extend_user_ttl` only changes lifetimes, never values.
 */
import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "../config";
import { pool } from "../db";
import { createOpsAlertSink, OpsAlertSink } from "./opsAlerts";
import { SorobanService } from "./soroban";

const LEDGERS_PER_DAY = 17_280;
/** Matches the contract's PERSISTENT_TTL_THRESHOLD: extending above it is a no-op on-chain. */
export const EXTEND_BELOW_LEDGERS = LEDGERS_PER_DAY * 7;

function persistentKey(contractId: string, key: StellarSdk.xdr.ScVal): StellarSdk.xdr.LedgerKey {
  return StellarSdk.xdr.LedgerKey.contractData(
    new StellarSdk.xdr.LedgerKeyContractData({
      contract: new StellarSdk.Address(contractId).toScAddress(),
      key,
      durability: StellarSdk.xdr.ContractDataDurability.persistent,
    })
  );
}

function variant(name: string, ...fields: StellarSdk.xdr.ScVal[]): StellarSdk.xdr.ScVal {
  return StellarSdk.xdr.ScVal.scvVec([StellarSdk.xdr.ScVal.scvSymbol(name), ...fields]);
}

/** Ledger keys of every per-user entry the keeper watches, in a stable order. */
export function userLedgerKeys(
  contractId: string,
  user: string,
  assetCodes: string[]
): StellarSdk.xdr.LedgerKey[] {
  const addr = new StellarSdk.Address(user).toScVal();
  const keys = [persistentKey(contractId, variant("UserAssets", addr))];
  for (const code of assetCodes) {
    const codeVal = StellarSdk.nativeToScVal(code, { type: "string" });
    keys.push(persistentKey(contractId, variant("SpendLimit", addr, codeVal)));
    keys.push(persistentKey(contractId, variant("LimitOptIn", addr, codeVal)));
  }
  return keys;
}

export interface TtlKeeperDeps {
  contractId: string;
  listActiveWallets(): Promise<string[]>;
  getAssetCodes(user: string): Promise<string[]>;
  getLiveUntil(keys: StellarSdk.xdr.LedgerKey[]): Promise<Map<string, number>>;
  getLatestLedger(): Promise<number>;
  extendUserTtl(user: string): Promise<void>;
  alert: OpsAlertSink;
  alertBelowLedgers: number;
}

export interface WalletTtlReport {
  user: string;
  /** Smallest remaining TTL (ledgers) across live entries; null if the wallet has none. */
  minRemaining: number | null;
  extended: boolean;
  error?: string;
}

export class TtlKeeper {
  constructor(private readonly deps: TtlKeeperDeps) {}

  async checkWallet(user: string, latestLedger: number): Promise<WalletTtlReport> {
    const { deps } = this;
    try {
      const codes = await deps.getAssetCodes(user);
      const keys = userLedgerKeys(deps.contractId, user, codes);
      const liveUntil = await deps.getLiveUntil(keys);
      let minRemaining: number | null = null;
      for (const ledger of liveUntil.values()) {
        const remaining = ledger - latestLedger;
        if (minRemaining === null || remaining < minRemaining) minRemaining = remaining;
      }
      // UserAssets is written by add_asset; if it has data but is not live
      // any more, it is archived and needs a restore + extend.
      const archived = codes.length > 0 && !liveUntil.has(keys[0].toXDR("base64"));
      if (minRemaining === null && !archived) return { user, minRemaining, extended: false };

      if (archived || (minRemaining !== null && minRemaining < deps.alertBelowLedgers)) {
        await deps.alert({
          kind: "ttl_near_expiry",
          message: archived
            ? `Wallet ${user} has archived entries; restoring`
            : `Wallet ${user} entries expire in ${minRemaining} ledgers`,
          details: { user, minRemaining, latestLedger, archived },
        });
      }
      const extended = archived || (minRemaining !== null && minRemaining < EXTEND_BELOW_LEDGERS);
      if (extended) await deps.extendUserTtl(user);
      return { user, minRemaining, extended };
    } catch (err) {
      const message = (err as Error).message;
      await deps.alert({
        kind: "ttl_extend_failed",
        message: `TTL keeper failed for ${user}: ${message}`,
        details: { user },
      });
      return { user, minRemaining: null, extended: false, error: message };
    }
  }

  /** One sweep over every active wallet. Never throws for a single wallet's failure. */
  async runOnce(): Promise<WalletTtlReport[]> {
    const latest = await this.deps.getLatestLedger();
    const wallets = await this.deps.listActiveWallets();
    const reports: WalletTtlReport[] = [];
    for (const user of wallets) {
      reports.push(await this.checkWallet(user, latest));
    }
    return reports;
  }
}

async function listActiveWalletsFromDevices(days: number): Promise<string[]> {
  const { rows } = await pool.query<{ account: string }>(
    "SELECT DISTINCT account FROM devices WHERE last_seen_at > NOW() - ($1 || ' days')::interval",
    [String(days)]
  );
  return rows.map((r) => r.account).filter((a) => StellarSdk.StrKey.isValidEd25519PublicKey(a));
}

/**
 * Starts the keeper loop if TTL_KEEPER_SECRET_KEY and GLOBE_WALLET_CONTRACT_ID
 * are configured. Returns a stop function (no-op when disabled).
 */
export function startTtlKeeper(soroban = new SorobanService()): () => void {
  const contractId = config.GLOBE_WALLET_CONTRACT_ID;
  const secret = config.TTL_KEEPER_SECRET_KEY;
  if (!contractId || !secret) {
    console.warn("[ttl-keeper] GLOBE_WALLET_CONTRACT_ID or TTL_KEEPER_SECRET_KEY not set, keeper disabled");
    return () => undefined;
  }
  const feePayer = StellarSdk.Keypair.fromSecret(secret).publicKey();
  const keeper = new TtlKeeper({
    contractId,
    listActiveWallets: () => listActiveWalletsFromDevices(config.TTL_KEEPER_ACTIVE_DAYS),
    getAssetCodes: async (user) => {
      const assets = await soroban.simulate<Array<{ code: string }>>({
        contractId,
        method: "get_assets",
        args: [new StellarSdk.Address(user).toScVal()],
        sourcePublicKey: feePayer,
      });
      return (assets ?? []).map((a) => a.code);
    },
    getLiveUntil: (keys) => soroban.getLiveUntil(keys),
    getLatestLedger: () => soroban.getLatestLedger(),
    extendUserTtl: async (user) => {
      await soroban.invoke({
        contractId,
        method: "extend_user_ttl",
        args: [new StellarSdk.Address(user).toScVal()],
        sourceSecretKey: secret,
      });
    },
    alert: createOpsAlertSink(),
    alertBelowLedgers: config.TTL_KEEPER_ALERT_LEDGERS,
  });

  const tick = () => {
    keeper
      .runOnce()
      .then((reports) => {
        const extended = reports.filter((r) => r.extended).length;
        console.log(`[ttl-keeper] swept ${reports.length} wallet(s), extended ${extended}`);
      })
      .catch((err: Error) => console.error("[ttl-keeper] sweep failed", err.message));
  };
  tick();
  const timer = setInterval(tick, config.TTL_KEEPER_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
