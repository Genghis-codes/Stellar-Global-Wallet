import * as StellarSdk from "@stellar/stellar-sdk";
import { StellarService } from "../../src/services/stellar";
import { MemoRequiredError } from "../../src/services/stellarErrors";

function fakeAccountResponse(publicKey: string, sequence: string, dataAttr?: Record<string, string>) {
  const account = new StellarSdk.Account(publicKey, sequence) as unknown as StellarSdk.Horizon.AccountResponse;
  if (dataAttr) {
    (account as any).data_attr = dataAttr;
  }
  return account;
}

describe("StellarService.sendPayment SEP-29 memo check (issue #6)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("allows send when destination does not require a memo", async () => {
    const sourceKeypair = StellarSdk.Keypair.random();
    const destination = StellarSdk.Keypair.random().publicKey();

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
      .mockImplementation(async (publicKey: string) => fakeAccountResponse(publicKey, "100"));

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
      .mockImplementation(async () => {
        return { hash: "hash", successful: true } as unknown as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse;
      });

    const stellar = new StellarService();

    const result = await stellar.sendPayment({
      sourceSecretKey: sourceKeypair.secret(),
      destinationPublicKey: destination,
      amount: "10",
    });

    expect(result.successful).toBe(true);
  });

  it("throws MemoRequiredError when destination requires memo but none is provided", async () => {
    const sourceKeypair = StellarSdk.Keypair.random();
    const destination = StellarSdk.Keypair.random().publicKey();

    // loadAccount is called twice: once for SEP-29 check (destination),
    // once for building the transaction (source).
    let callCount = 0;
    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
      .mockImplementation(async (publicKey: string) => {
        callCount++;
        if (publicKey === destination) {
          return fakeAccountResponse(publicKey, "100", {
            "config.memo_required": "MQ==",
          });
        }
        return fakeAccountResponse(publicKey, "100");
      });

    const stellar = new StellarService();

    const promise = stellar.sendPayment({
      sourceSecretKey: sourceKeypair.secret(),
      destinationPublicKey: destination,
      amount: "10",
    });

    await expect(promise).rejects.toBeInstanceOf(MemoRequiredError);
    await expect(promise).rejects.toMatchObject({
      code: "MEMO_REQUIRED",
      retryable: false,
    });
    await expect(promise).rejects.toThrow(/requires a memo/);
  });

  it("allows send when destination requires memo and one is provided", async () => {
    const sourceKeypair = StellarSdk.Keypair.random();
    const destination = StellarSdk.Keypair.random().publicKey();

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
      .mockImplementation(async (publicKey: string) => {
        if (publicKey === destination) {
          return fakeAccountResponse(publicKey, "100", {
            "config.memo_required": "MQ==",
          });
        }
        return fakeAccountResponse(publicKey, "100");
      });

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
      .mockImplementation(async () => {
        return { hash: "hash", successful: true } as unknown as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse;
      });

    const stellar = new StellarService();

    const result = await stellar.sendPayment({
      sourceSecretKey: sourceKeypair.secret(),
      destinationPublicKey: destination,
      amount: "10",
      memo: "deposit-ref-123",
    });

    expect(result.successful).toBe(true);
  });

  it("does not check memo when destination account does not exist", async () => {
    const sourceKeypair = StellarSdk.Keypair.random();
    const destination = StellarSdk.Keypair.random().publicKey();

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
      .mockImplementation(async (publicKey: string) => {
        if (publicKey === destination) {
          throw new Error("Account does not exist");
        }
        return fakeAccountResponse(publicKey, "100");
      });

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
      .mockImplementation(async () => {
        return { hash: "hash", successful: true } as unknown as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse;
      });

    const stellar = new StellarService();

    const result = await stellar.sendPayment({
      sourceSecretKey: sourceKeypair.secret(),
      destinationPublicKey: destination,
      amount: "10",
    });

    expect(result.successful).toBe(true);
  });

  it("destinationRequiresMemo returns true when SEP-29 data entry is set", async () => {
    const destination = StellarSdk.Keypair.random().publicKey();

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
      .mockImplementation(async (publicKey: string) => {
        return fakeAccountResponse(publicKey, "100", {
          "config.memo_required": "MQ==",
        });
      });

    const stellar = new StellarService();
    const result = await stellar.destinationRequiresMemo(destination);
    expect(result).toBe(true);
  });

  it("destinationRequiresMemo returns false when no data entry is set", async () => {
    const destination = StellarSdk.Keypair.random().publicKey();

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
      .mockImplementation(async (publicKey: string) => {
        return fakeAccountResponse(publicKey, "100");
      });

    const stellar = new StellarService();
    const result = await stellar.destinationRequiresMemo(destination);
    expect(result).toBe(false);
  });

  it("destinationRequiresMemo returns false when account does not exist", async () => {
    const destination = StellarSdk.Keypair.random().publicKey();

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
      .mockImplementation(async () => {
        throw new Error("Account does not exist");
      });

    const stellar = new StellarService();
    const result = await stellar.destinationRequiresMemo(destination);
    expect(result).toBe(false);
  });
});
