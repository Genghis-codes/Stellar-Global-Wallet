import * as StellarSdk from "@stellar/stellar-sdk";
import { SorobanService } from "../../src/services/soroban";
import { SorobanSimulationError, SorobanTransactionError } from "../../src/services/sorobanErrors";

const { rpc } = StellarSdk;

function fakeAccount(publicKey: string, sequence = "100") {
  return new StellarSdk.Account(publicKey, sequence);
}

/** Minimal well-formed success simulation response, as the parsed (non-raw) shape. */
function fakeSuccessSimulation(retval: StellarSdk.xdr.ScVal): StellarSdk.rpc.Api.SimulateTransactionSuccessResponse {
  return {
    id: "1",
    latestLedger: 1000,
    events: [],
    _parsed: true,
    transactionData: new StellarSdk.SorobanDataBuilder(),
    minResourceFee: "100",
    cost: { cpuInsns: "0", memBytes: "0" },
    result: { auth: [], retval },
  };
}

/** Minimal well-formed error simulation response. */
function fakeErrorSimulation(error: string): StellarSdk.rpc.Api.SimulateTransactionErrorResponse {
  return { id: "1", latestLedger: 1000, events: [], _parsed: true, error };
}

describe("SorobanService.simulate", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns the decoded return value without ever calling sendTransaction", async () => {
    const contractId = "CBGLPMNSM4FWMIZ6FFBSRN7FNVCHCI2SLZNODA27LEOXFPLWNYEAEP3K";
    const publicKey = StellarSdk.Keypair.random().publicKey();
    const retval = StellarSdk.nativeToScVal([{ code: "XLM", issuer: null }]);

    jest.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValue(fakeAccount(publicKey));
    jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValue(fakeSuccessSimulation(retval));
    const sendSpy = jest.spyOn(rpc.Server.prototype, "sendTransaction");

    const soroban = new SorobanService();
    const result = await soroban.simulate({
      contractId,
      method: "get_assets",
      args: [StellarSdk.nativeToScVal(publicKey, { type: "address" })],
      sourcePublicKey: publicKey,
    });

    expect(result).toEqual([{ code: "XLM", issuer: null }]);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("throws SorobanSimulationError on a failed simulation and never calls sendTransaction", async () => {
    const publicKey = StellarSdk.Keypair.random().publicKey();
    jest.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValue(fakeAccount(publicKey));
    jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValue(fakeErrorSimulation("HostError: Error(Contract, #1007)"));
    const sendSpy = jest.spyOn(rpc.Server.prototype, "sendTransaction");

    const soroban = new SorobanService();
    const promise = soroban.simulate({
      contractId: "CBGLPMNSM4FWMIZ6FFBSRN7FNVCHCI2SLZNODA27LEOXFPLWNYEAEP3K",
      method: "get_assets",
      args: [],
      sourcePublicKey: publicKey,
    });

    await expect(promise).rejects.toBeInstanceOf(SorobanSimulationError);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe("SorobanService.invoke", () => {
  afterEach(() => jest.restoreAllMocks());

  it(
    "never submits a transaction when simulation fails — this is the DoD's " +
      "'catch failures cheaply before paying for a real invocation' guarantee",
    async () => {
      const keypair = StellarSdk.Keypair.random();
      jest.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValue(fakeAccount(keypair.publicKey()));
      jest
        .spyOn(rpc.Server.prototype, "simulateTransaction")
        .mockResolvedValue(fakeErrorSimulation("HostError: Error(Contract, #1007)"));
      const sendSpy = jest.spyOn(rpc.Server.prototype, "sendTransaction");
      const getTxSpy = jest.spyOn(rpc.Server.prototype, "getTransaction");

      const soroban = new SorobanService();
      const promise = soroban.invoke({
        contractId: "CBGLPMNSM4FWMIZ6FFBSRN7FNVCHCI2SLZNODA27LEOXFPLWNYEAEP3K",
        method: "record_spend",
        args: [],
        sourceSecretKey: keypair.secret(),
      });

      await expect(promise).rejects.toBeInstanceOf(SorobanSimulationError);
      expect(sendSpy).not.toHaveBeenCalled();
      expect(getTxSpy).not.toHaveBeenCalled();
    }
  );

  it("signs, submits, polls, and returns the decoded result on success", async () => {
    const keypair = StellarSdk.Keypair.random();
    const hash = "a".repeat(64);

    jest.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValue(fakeAccount(keypair.publicKey()));
    jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValue(fakeSuccessSimulation(StellarSdk.xdr.ScVal.scvVoid()));
    jest.spyOn(rpc.Server.prototype, "sendTransaction").mockResolvedValue({
      status: "PENDING",
      hash,
      latestLedger: 1000,
      latestLedgerCloseTime: 0,
    });
    jest.spyOn(rpc.Server.prototype, "getTransaction").mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
      latestLedger: 1001,
      latestLedgerCloseTime: 0,
      oldestLedger: 1,
      oldestLedgerCloseTime: 0,
      ledger: 1001,
      createdAt: 0,
      applicationOrder: 1,
      feeBump: false,
      envelopeXdr: {} as StellarSdk.xdr.TransactionEnvelope,
      resultXdr: {} as StellarSdk.xdr.TransactionResult,
      resultMetaXdr: {} as StellarSdk.xdr.TransactionMeta,
      returnValue: StellarSdk.xdr.ScVal.scvVoid(),
    });

    const soroban = new SorobanService();
    const result = await soroban.invoke({
      contractId: "CBGLPMNSM4FWMIZ6FFBSRN7FNVCHCI2SLZNODA27LEOXFPLWNYEAEP3K",
      method: "record_spend",
      args: [],
      sourceSecretKey: keypair.secret(),
    });

    expect(result.hash).toBe(hash);
    expect(result.ledger).toBe(1001);
    expect(result.result).toBeNull();
  });

  it("polls through NOT_FOUND before reaching a final status", async () => {
    jest.useFakeTimers();
    const keypair = StellarSdk.Keypair.random();
    const hash = "b".repeat(64);

    jest.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValue(fakeAccount(keypair.publicKey()));
    jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValue(fakeSuccessSimulation(StellarSdk.xdr.ScVal.scvVoid()));
    jest.spyOn(rpc.Server.prototype, "sendTransaction").mockResolvedValue({
      status: "PENDING",
      hash,
      latestLedger: 1000,
      latestLedgerCloseTime: 0,
    });
    const getTxSpy = jest
      .spyOn(rpc.Server.prototype, "getTransaction")
      .mockResolvedValueOnce({
        status: rpc.Api.GetTransactionStatus.NOT_FOUND,
        latestLedger: 1000,
        latestLedgerCloseTime: 0,
        oldestLedger: 1,
        oldestLedgerCloseTime: 0,
      })
      .mockResolvedValueOnce({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
        latestLedger: 1001,
        latestLedgerCloseTime: 0,
        oldestLedger: 1,
        oldestLedgerCloseTime: 0,
        ledger: 1001,
        createdAt: 0,
        applicationOrder: 1,
        feeBump: false,
        envelopeXdr: {} as StellarSdk.xdr.TransactionEnvelope,
        resultXdr: {} as StellarSdk.xdr.TransactionResult,
        resultMetaXdr: {} as StellarSdk.xdr.TransactionMeta,
        returnValue: StellarSdk.xdr.ScVal.scvVoid(),
      });

    const soroban = new SorobanService();
    const resultPromise = soroban.invoke({
      contractId: "CBGLPMNSM4FWMIZ6FFBSRN7FNVCHCI2SLZNODA27LEOXFPLWNYEAEP3K",
      method: "record_spend",
      args: [],
      sourceSecretKey: keypair.secret(),
    });

    await jest.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(result.hash).toBe(hash);
    expect(getTxSpy).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it("throws SorobanTransactionError when a transaction fails on-chain after simulation succeeded", async () => {
    const keypair = StellarSdk.Keypair.random();
    const hash = "c".repeat(64);

    jest.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValue(fakeAccount(keypair.publicKey()));
    jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValue(fakeSuccessSimulation(StellarSdk.xdr.ScVal.scvVoid()));
    jest.spyOn(rpc.Server.prototype, "sendTransaction").mockResolvedValue({
      status: "PENDING",
      hash,
      latestLedger: 1000,
      latestLedgerCloseTime: 0,
    });
    jest.spyOn(rpc.Server.prototype, "getTransaction").mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.FAILED,
      latestLedger: 1001,
      latestLedgerCloseTime: 0,
      oldestLedger: 1,
      oldestLedgerCloseTime: 0,
      ledger: 1001,
      createdAt: 0,
      applicationOrder: 1,
      feeBump: false,
      envelopeXdr: {} as StellarSdk.xdr.TransactionEnvelope,
      resultXdr: {} as StellarSdk.xdr.TransactionResult,
      resultMetaXdr: {} as StellarSdk.xdr.TransactionMeta,
    });

    const soroban = new SorobanService();
    const promise = soroban.invoke({
      contractId: "CBGLPMNSM4FWMIZ6FFBSRN7FNVCHCI2SLZNODA27LEOXFPLWNYEAEP3K",
      method: "record_spend",
      args: [],
      sourceSecretKey: keypair.secret(),
    });

    await expect(promise).rejects.toBeInstanceOf(SorobanTransactionError);
    await expect(promise).rejects.toMatchObject({ hash });
  });
});
