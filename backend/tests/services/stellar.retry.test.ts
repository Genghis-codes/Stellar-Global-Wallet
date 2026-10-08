import * as StellarSdk from "@stellar/stellar-sdk";
import { StellarService } from "../../src/services/stellar";
import { SequenceConflictError } from "../../src/services/stellarErrors";

function fakeAccountResponse(publicKey: string, sequence: string) {
  return new StellarSdk.Account(publicKey, sequence) as unknown as StellarSdk.Horizon.AccountResponse;
}

function txBadSeqError() {
  return new StellarSdk.BadResponseError(
    "Transaction submission failed. Server responded: 400 Bad Request",
    {
      type: "https://stellar.org/horizon-errors/transaction_failed",
      title: "Transaction Failed",
      status: 400,
      extras: {
        result_codes: { transaction: "tx_bad_seq" },
        result_xdr: "AAAAAAAAAGT/////AAAAAQ==",
      },
    }
  );
}

function opUnderfundedError() {
  return new StellarSdk.BadResponseError(
    "Transaction submission failed. Server responded: 400 Bad Request",
    {
      type: "https://stellar.org/horizon-errors/transaction_failed",
      title: "Transaction Failed",
      status: 400,
      extras: {
        result_codes: { transaction: "tx_failed", operations: ["op_underfunded"] },
        result_xdr: "AAAAAAAAAGT/////AAAAAQ==",
      },
    }
  );
}

describe("StellarService tx_bad_seq retry (issue #9)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("retries on tx_bad_seq and succeeds on second attempt", async () => {
    let loadAccountCalls = 0;
    let submitCalls = 0;
    let sequence = 100;

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
      .mockImplementation(async (publicKey: string) => {
        loadAccountCalls++;
        return fakeAccountResponse(publicKey, String(sequence));
      });

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
      .mockImplementation(async () => {
        submitCalls++;
        if (submitCalls === 1) {
          throw txBadSeqError();
        }
        sequence += 1;
        return { hash: "hash-ok", successful: true } as unknown as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse;
      });

    const stellar = new StellarService();
    const result = await stellar.sendPayment({
      sourceSecretKey: StellarSdk.Keypair.random().secret(),
      destinationPublicKey: StellarSdk.Keypair.random().publicKey(),
      amount: "1",
    });

    expect(result.hash).toBe("hash-ok");
    expect(result.successful).toBe(true);
    expect(loadAccountCalls).toBe(2);
    expect(submitCalls).toBe(2);
  });

  it("exhausts all retries and throws SequenceConflictError", async () => {
    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
      .mockImplementation(async (publicKey: string) => fakeAccountResponse(publicKey, "100"));

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
      .mockImplementation(async () => {
        throw txBadSeqError();
      });

    const stellar = new StellarService();
    const promise = stellar.sendPayment({
      sourceSecretKey: StellarSdk.Keypair.random().secret(),
      destinationPublicKey: StellarSdk.Keypair.random().publicKey(),
      amount: "1",
    });

    await expect(promise).rejects.toBeInstanceOf(SequenceConflictError);
  });

  it("does NOT retry non-tx_bad_seq errors (e.g. op_underfunded)", async () => {
    let submitCalls = 0;

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
      .mockImplementation(async (publicKey: string) => fakeAccountResponse(publicKey, "100"));

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
      .mockImplementation(async () => {
        submitCalls++;
        throw opUnderfundedError();
      });

    const stellar = new StellarService();
    const promise = stellar.sendPayment({
      sourceSecretKey: StellarSdk.Keypair.random().secret(),
      destinationPublicKey: StellarSdk.Keypair.random().publicKey(),
      amount: "1",
    });

    await expect(promise).rejects.toBeInstanceOf(StellarSdk.BadResponseError);
    expect(submitCalls).toBe(1);
  });

  it("logs retry attempts to the console", async () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();
    let submitCalls = 0;

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
      .mockImplementation(async (publicKey: string) => fakeAccountResponse(publicKey, "100"));

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
      .mockImplementation(async () => {
        submitCalls++;
        if (submitCalls <= 2) throw txBadSeqError();
        return { hash: "hash-logged", successful: true } as unknown as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse;
      });

    const stellar = new StellarService();
    await stellar.sendPayment({
      sourceSecretKey: StellarSdk.Keypair.random().secret(),
      destinationPublicKey: StellarSdk.Keypair.random().publicKey(),
      amount: "1",
    });

    const retryLogs = consoleSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("tx_bad_seq retry")
    );
    expect(retryLogs.length).toBeGreaterThanOrEqual(2);
  });
});
