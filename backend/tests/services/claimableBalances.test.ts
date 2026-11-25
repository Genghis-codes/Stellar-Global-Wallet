import {
  buildAccountClose,
  listClaimableBalances,
} from "../../src/services/claimableBalances";
import { isValidClaimableBalanceId } from "../../src/utils/claimableBalanceId";

describe("isValidClaimableBalanceId", () => {
  it("accepts Horizon's 72-char hex ids", () => {
    expect(isValidClaimableBalanceId("00000000" + "ab".repeat(32))).toBe(true);
  });

  it.each([
    "ab".repeat(36), // wrong discriminant
    "00000000" + "AB".repeat(32), // uppercase is rejected by the builder
    "00000000" + "ab".repeat(31),
    42,
  ])("rejects %p", (value) => {
    expect(isValidClaimableBalanceId(value)).toBe(false);
  });
});

describe("claimableBalances route helpers", () => {
  const stellar = {
    buildCloseAccountTransaction: jest.fn().mockResolvedValue({ kind: "build" }),
    dryRunCloseAccount: jest.fn().mockResolvedValue({ kind: "dry-run" }),
    listClaimableBalances: jest.fn().mockResolvedValue({ balances: [], next: null, hasMore: false }),
    buildClaimClaimableBalanceTransaction: jest.fn(),
    buildReclaimClaimableBalanceTransaction: jest.fn(),
  };

  it("routes dryRun to the dry-run builder", async () => {
    await expect(
      buildAccountClose(stellar as never, { publicKey: "GA", destination: "GB", dryRun: true })
    ).resolves.toEqual({ kind: "dry-run" });
    await expect(
      buildAccountClose(stellar as never, { publicKey: "GA", destination: "GB" })
    ).resolves.toEqual({ kind: "build" });
    expect(stellar.buildCloseAccountTransaction).toHaveBeenCalledWith({ account: "GA", destination: "GB" });
  });

  it("forwards paging to Horizon", async () => {
    await listClaimableBalances(stellar as never, { publicKey: "GA", limit: 10, cursor: "c1" });
    expect(stellar.listClaimableBalances).toHaveBeenCalledWith("GA", { limit: 10, cursor: "c1" });
  });
});
