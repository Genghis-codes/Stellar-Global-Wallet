import * as StellarSdk from "@stellar/stellar-sdk";
import { StellarService } from "../../src/services/stellar";
import { SequenceConflictError } from "../../src/services/stellarErrors";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// TransactionBuilder only needs accountId()/sequenceNumber()/
// incrementSequenceNumber() off of whatever loadAccount() returns — a
// plain StellarSdk.Account satisfies that at runtime. Horizon's real
// AccountResponse additionally carries balances/thresholds/etc. that this
// service doesn't touch when building a payment, so the cast is safe here.
function fakeAccountResponse(publicKey: string, sequence: string) {
  return new StellarSdk.Account(publicKey, sequence) as unknown as StellarSdk.Horizon.AccountResponse;
}

describe("StellarService.sendPayment concurrency (issue #3)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it(
    "does not let a second concurrent send for the same source account read " +
      "the account before the first one's submission has landed",
    async () => {
      const events: string[] = [];
      let sequence = 100;

      jest
        .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
        .mockImplementation(async (publicKey: string) => {
          events.push(`loadAccount:start`);
          // Yields to the event loop — if nothing is serializing calls for
          // this account, the second send's loadAccount fires in this
          // window, before the first send's submission has landed. That is
          // exactly the race from the issue: both reads see the same
          // sequence number.
          await sleep(15);
          events.push(`loadAccount:end`);
          return fakeAccountResponse(publicKey, String(sequence));
        });

      jest
        .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
        .mockImplementation(async () => {
          events.push("submitTransaction:start");
          await sleep(40);
          sequence += 1;
          events.push("submitTransaction:end");
          return { hash: `hash-${sequence}`, successful: true } as unknown as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse;
        });

      const stellar = new StellarService();
      const sourceKeypair = StellarSdk.Keypair.random();
      const destinationA = StellarSdk.Keypair.random().publicKey();
      const destinationB = StellarSdk.Keypair.random().publicKey();

      const send = (destination: string) =>
        stellar.sendPayment({
          sourceSecretKey: sourceKeypair.secret(),
          destinationPublicKey: destination,
          amount: "1",
        });

      const [resultA, resultB] = await Promise.all([send(destinationA), send(destinationB)]);

      expect(resultA.successful).toBe(true);
      expect(resultB.successful).toBe(true);

      // Exactly this sequence proves no interleaving: both loadAccount
      // calls read a value after the previous submission fully resolved.
      expect(events).toEqual([
        "loadAccount:start",
        "loadAccount:end",
        "submitTransaction:start",
        "submitTransaction:end",
        "loadAccount:start",
        "loadAccount:end",
        "submitTransaction:start",
        "submitTransaction:end",
      ]);
    }
  );

  it("does not serialize sends for two different source accounts against each other", async () => {
    const events: string[] = [];

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
      .mockImplementation(async (publicKey: string) => {
        events.push(`loadAccount:${publicKey}`);
        return fakeAccountResponse(publicKey, "100");
      });

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
      .mockImplementation(async () => {
        // Account 1's submission is slow; account 2's should not have to
        // wait for it — they don't share a source account.
        await sleep(50);
        return { hash: "hash", successful: true } as unknown as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse;
      });

    const stellar = new StellarService();
    const keypair1 = StellarSdk.Keypair.random();
    const keypair2 = StellarSdk.Keypair.random();
    const destination = StellarSdk.Keypair.random().publicKey();

    const start = Date.now();
    await Promise.all([
      stellar.sendPayment({
        sourceSecretKey: keypair1.secret(),
        destinationPublicKey: destination,
        amount: "1",
      }),
      stellar.sendPayment({
        sourceSecretKey: keypair2.secret(),
        destinationPublicKey: destination,
        amount: "1",
      }),
    ]);
    const elapsedMs = Date.now() - start;

    // If these were incorrectly serialized against a shared/global lock,
    // this would take ~100ms (two sequential 50ms submits) instead of ~50ms.
    expect(elapsedMs).toBeLessThan(90);
  });

  it("translates a Horizon tx_bad_seq rejection into a clear, actionable SequenceConflictError", async () => {
    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
      .mockImplementation(async (publicKey: string) => fakeAccountResponse(publicKey, "100"));

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
      .mockImplementation(async () => {
        throw new StellarSdk.BadResponseError("Transaction submission failed. Server responded: 400 Bad Request", {
          type: "https://stellar.org/horizon-errors/transaction_failed",
          title: "Transaction Failed",
          status: 400,
          extras: {
            result_codes: { transaction: "tx_bad_seq" },
            result_xdr: "AAAAAAAAAGT/////AAAAAQ==",
          },
        });
      });

    const stellar = new StellarService();
    const sourceKeypair = StellarSdk.Keypair.random();
    const destination = StellarSdk.Keypair.random().publicKey();

    const promise = stellar.sendPayment({
      sourceSecretKey: sourceKeypair.secret(),
      destinationPublicKey: destination,
      amount: "1",
    });

    await expect(promise).rejects.toBeInstanceOf(SequenceConflictError);
    await expect(promise).rejects.toMatchObject({
      code: "SEQUENCE_CONFLICT",
      retryable: true,
    });
    await expect(promise).rejects.toThrow(/Safe to retry/);
  });

  it("passes through non-sequence Horizon errors unchanged", async () => {
    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
      .mockImplementation(async (publicKey: string) => fakeAccountResponse(publicKey, "100"));

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
      .mockImplementation(async () => {
        throw new StellarSdk.BadResponseError("Transaction submission failed. Server responded: 400 Bad Request", {
          type: "https://stellar.org/horizon-errors/transaction_failed",
          title: "Transaction Failed",
          status: 400,
          extras: { result_codes: { transaction: "tx_insufficient_balance" } },
        });
      });

    const stellar = new StellarService();
    const sourceKeypair = StellarSdk.Keypair.random();
    const destination = StellarSdk.Keypair.random().publicKey();

    const promise = stellar.sendPayment({
      sourceSecretKey: sourceKeypair.secret(),
      destinationPublicKey: destination,
      amount: "1",
    });

    await expect(promise).rejects.not.toBeInstanceOf(SequenceConflictError);
    await expect(promise).rejects.toBeInstanceOf(StellarSdk.BadResponseError);
  });
});
