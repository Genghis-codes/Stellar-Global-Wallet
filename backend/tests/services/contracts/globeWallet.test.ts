import * as StellarSdk from "@stellar/stellar-sdk";
import { SorobanService } from "../../../src/services/soroban";
import { GlobeWalletContract } from "../../../src/services/contracts/globeWallet";
import { SorobanSimulationError } from "../../../src/services/sorobanErrors";

describe("GlobeWalletContract.getAssets", () => {
  afterEach(() => jest.restoreAllMocks());

  it("encodes the user public key as an ScVal address and returns the decoded assets", async () => {
    const simulateSpy = jest
      .spyOn(SorobanService.prototype, "simulate")
      .mockResolvedValue([{ code: "XLM", issuer: null }]);

    const soroban = new SorobanService();
    const contract = new GlobeWalletContract(soroban);
    const userPublicKey = StellarSdk.Keypair.random().publicKey();

    const assets = await contract.getAssets(userPublicKey);

    expect(assets).toEqual([{ code: "XLM", issuer: null }]);
    expect(simulateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "get_assets",
        sourcePublicKey: userPublicKey,
        args: [StellarSdk.nativeToScVal(userPublicKey, { type: "address" })],
      })
    );
  });

  it("translates a raw contract error code into a readable name", async () => {
    jest
      .spyOn(SorobanService.prototype, "simulate")
      .mockRejectedValue(new SorobanSimulationError("Simulation failed: HostError: Error(Contract, #1005)", "HostError: Error(Contract, #1005)"));

    const contract = new GlobeWalletContract(new SorobanService());
    const promise = contract.getAssets(StellarSdk.Keypair.random().publicKey());

    await expect(promise).rejects.toThrow(/AssetNotFound \(contract error #1005\)/);
  });
});

describe("GlobeWalletContract.recordSpend", () => {
  afterEach(() => jest.restoreAllMocks());

  it("encodes user/asset_code/amount as address/string/i128 ScVals signed by the user's own key", async () => {
    const invokeSpy = jest
      .spyOn(SorobanService.prototype, "invoke")
      .mockResolvedValue({ result: null, hash: "deadbeef", ledger: 42 });

    const soroban = new SorobanService();
    const contract = new GlobeWalletContract(soroban);
    const userKeypair = StellarSdk.Keypair.random();

    const result = await contract.recordSpend({
      userSecretKey: userKeypair.secret(),
      assetCode: "XLM",
      amount: "500000",
    });

    expect(result).toEqual({ result: null, hash: "deadbeef", ledger: 42 });
    expect(invokeSpy).toHaveBeenCalledWith({
      contractId: expect.any(String),
      method: "record_spend",
      sourceSecretKey: userKeypair.secret(),
      args: [
        StellarSdk.nativeToScVal(userKeypair.publicKey(), { type: "address" }),
        StellarSdk.nativeToScVal("XLM", { type: "string" }),
        StellarSdk.nativeToScVal(500000n, { type: "i128" }),
      ],
    });
  });

  it("translates a spend-limit rejection into a readable error before any state changes", async () => {
    jest
      .spyOn(SorobanService.prototype, "invoke")
      .mockRejectedValue(
        new SorobanSimulationError(
          "Simulation failed for C....record_spend: HostError: Error(Contract, #1007)",
          "HostError: Error(Contract, #1007)"
        )
      );

    const contract = new GlobeWalletContract(new SorobanService());
    const promise = contract.recordSpend({
      userSecretKey: StellarSdk.Keypair.random().secret(),
      assetCode: "XLM",
      amount: "999999999",
    });

    await expect(promise).rejects.toBeInstanceOf(SorobanSimulationError);
    await expect(promise).rejects.toThrow(/SpendLimitExceeded \(contract error #1007\)/);
  });
});
