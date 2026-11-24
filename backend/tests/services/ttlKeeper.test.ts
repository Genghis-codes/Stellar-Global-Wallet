import * as StellarSdk from "@stellar/stellar-sdk";
import { EXTEND_BELOW_LEDGERS, TtlKeeper, TtlKeeperDeps, userLedgerKeys } from "../../src/services/ttlKeeper";

const CONTRACT_ID = "CBGLPMNSM4FWMIZ6FFBSRN7FNVCHCI2SLZNODA27LEOXFPLWNYEAEP3K";
const USER = StellarSdk.Keypair.random().publicKey();
const LATEST = 1_000_000;

function deps(overrides: Partial<TtlKeeperDeps> = {}): TtlKeeperDeps & {
  alert: jest.Mock;
  extendUserTtl: jest.Mock;
} {
  return {
    contractId: CONTRACT_ID,
    listActiveWallets: jest.fn().mockResolvedValue([USER]),
    getAssetCodes: jest.fn().mockResolvedValue(["XLM"]),
    getLiveUntil: jest.fn().mockResolvedValue(new Map()),
    getLatestLedger: jest.fn().mockResolvedValue(LATEST),
    extendUserTtl: jest.fn().mockResolvedValue(undefined),
    alert: jest.fn().mockResolvedValue(undefined),
    alertBelowLedgers: 17_280 * 3,
    ...overrides,
  } as never;
}

function liveMap(remaining: number[]): Map<string, number> {
  const keys = userLedgerKeys(CONTRACT_ID, USER, ["XLM"]);
  const m = new Map<string, number>();
  remaining.forEach((r, i) => m.set(keys[i].toXDR("base64"), LATEST + r));
  return m;
}

describe("userLedgerKeys", () => {
  it("builds UserAssets plus SpendLimit/LimitOptIn keys per asset", () => {
    const keys = userLedgerKeys(CONTRACT_ID, USER, ["XLM", "USDC"]);
    expect(keys).toHaveLength(5);
    // stellar-sdk 17 XDR: union arms and struct fields are properties.
    const key = keys[0];
    if (key.type !== "contractData") throw new Error(`expected a contractData key, got ${key.type}`);
    const first = key.contractData;
    expect(first.durability).toBe(StellarSdk.xdr.ContractDataDurability.persistent);
    expect(StellarSdk.scValToNative(first.key)).toEqual(["UserAssets", USER]);
  });
});

describe("TtlKeeper", () => {
  it("does nothing for healthy wallets", async () => {
    const d = deps({ getLiveUntil: jest.fn().mockResolvedValue(liveMap([EXTEND_BELOW_LEDGERS + 10, EXTEND_BELOW_LEDGERS + 10])) });
    const [report] = await new TtlKeeper(d).runOnce();
    expect(report.extended).toBe(false);
    expect(d.extendUserTtl).not.toHaveBeenCalled();
    expect(d.alert).not.toHaveBeenCalled();
  });

  it("extends when the shortest TTL falls below the contract threshold", async () => {
    const d = deps({ getLiveUntil: jest.fn().mockResolvedValue(liveMap([EXTEND_BELOW_LEDGERS + 10, EXTEND_BELOW_LEDGERS - 10])) });
    const [report] = await new TtlKeeper(d).runOnce();
    expect(report.extended).toBe(true);
    expect(report.minRemaining).toBe(EXTEND_BELOW_LEDGERS - 10);
    expect(d.extendUserTtl).toHaveBeenCalledWith(USER);
    expect(d.alert).not.toHaveBeenCalled();
  });

  it("alerts on near-expiry", async () => {
    const d = deps({ getLiveUntil: jest.fn().mockResolvedValue(liveMap([100])) });
    await new TtlKeeper(d).runOnce();
    expect(d.alert).toHaveBeenCalledWith(expect.objectContaining({ kind: "ttl_near_expiry" }));
    expect(d.extendUserTtl).toHaveBeenCalled();
  });

  it("treats a missing UserAssets entry for a wallet with assets as archived and restores it", async () => {
    const d = deps({ getLiveUntil: jest.fn().mockResolvedValue(new Map()) });
    const [report] = await new TtlKeeper(d).runOnce();
    expect(report.extended).toBe(true);
    expect(d.alert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "ttl_near_expiry", details: expect.objectContaining({ archived: true }) })
    );
  });

  it("skips wallets with no entries at all", async () => {
    const d = deps({ getAssetCodes: jest.fn().mockResolvedValue([]) });
    const [report] = await new TtlKeeper(d).runOnce();
    expect(report).toEqual({ user: USER, minRemaining: null, extended: false });
  });

  it("alerts and keeps sweeping when one wallet fails", async () => {
    const other = StellarSdk.Keypair.random().publicKey();
    const d = deps({
      listActiveWallets: jest.fn().mockResolvedValue([USER, other]),
      getAssetCodes: jest.fn().mockRejectedValueOnce(new Error("rpc down")).mockResolvedValue([]),
    });
    const reports = await new TtlKeeper(d).runOnce();
    expect(reports).toHaveLength(2);
    expect(reports[0].error).toBe("rpc down");
    expect(d.alert).toHaveBeenCalledWith(expect.objectContaining({ kind: "ttl_extend_failed" }));
  });
});
