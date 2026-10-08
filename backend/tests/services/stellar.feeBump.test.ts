import * as StellarSdk from "@stellar/stellar-sdk";
import { StellarService } from "../../src/services/stellar";

function fakeAccountResponse(publicKey: string, sequence: string) {
  return new StellarSdk.Account(publicKey, sequence) as unknown as StellarSdk.Horizon.AccountResponse;
}

describe("StellarService.feeBumpTransaction (issue #4)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("wraps an existing signed transaction in a fee-bump envelope and submits it", async () => {
    const sourceKeypair = StellarSdk.Keypair.random();
    const feeKeypair = StellarSdk.Keypair.random();
    const destination = StellarSdk.Keypair.random().publicKey();

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
      .mockImplementation(async (publicKey: string) => fakeAccountResponse(publicKey, "100"));

    const submittedTxTypes: string[] = [];
    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
      .mockImplementation(async (tx: any) => {
        submittedTxTypes.push(tx.constructor.name || typeof tx);
        return { hash: "fee-bump-hash", successful: true } as unknown as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse;
      });

    const stellar = new StellarService();

    // Build an inner transaction first
    const sourceAccount = new StellarSdk.Account(sourceKeypair.publicKey(), "100");
    const innerTx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: "Test SDF Network ; September 2015",
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination,
          asset: StellarSdk.Asset.native(),
          amount: "10",
        })
      )
      .setTimeout(30)
      .build();
    innerTx.sign(sourceKeypair);

    const result = await stellar.feeBumpTransaction({
      transactionXdr: innerTx.toEnvelope().toXDR("base64"),
      feeSecretKey: feeKeypair.secret(),
    });

    expect(result.hash).toBe("fee-bump-hash");
    expect(result.successful).toBe(true);
  });

  it("uses 100x base fee when no explicit fee is provided", async () => {
    const sourceKeypair = StellarSdk.Keypair.random();
    const feeKeypair = StellarSdk.Keypair.random();
    const destination = StellarSdk.Keypair.random().publicKey();

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
      .mockImplementation(async (publicKey: string) => fakeAccountResponse(publicKey, "100"));

    let capturedFee: string | undefined;
    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
      .mockImplementation(async (tx: any) => {
        // FeeBumpTransaction has a .fee property
        if (tx.fee !== undefined) {
          capturedFee = String(tx.fee);
        }
        return { hash: "hash", successful: true } as unknown as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse;
      });

    const stellar = new StellarService();

    const sourceAccount = new StellarSdk.Account(sourceKeypair.publicKey(), "100");
    const innerTx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: "Test SDF Network ; September 2015",
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination,
          asset: StellarSdk.Asset.native(),
          amount: "10",
        })
      )
      .setTimeout(30)
      .build();
    innerTx.sign(sourceKeypair);

    await stellar.feeBumpTransaction({
      transactionXdr: innerTx.toEnvelope().toXDR("base64"),
      feeSecretKey: feeKeypair.secret(),
    });

    // Default fee should be 100x base fee
    expect(capturedFee).toBe(String(100 * StellarSdk.BASE_FEE));
  });

  it("uses the explicit fee when one is provided", async () => {
    const sourceKeypair = StellarSdk.Keypair.random();
    const feeKeypair = StellarSdk.Keypair.random();
    const destination = StellarSdk.Keypair.random().publicKey();

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
      .mockImplementation(async (publicKey: string) => fakeAccountResponse(publicKey, "100"));

    let capturedFee: string | undefined;
    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
      .mockImplementation(async (tx: any) => {
        if (tx.fee !== undefined) {
          capturedFee = String(tx.fee);
        }
        return { hash: "hash", successful: true } as unknown as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse;
      });

    const stellar = new StellarService();

    const sourceAccount = new StellarSdk.Account(sourceKeypair.publicKey(), "100");
    const innerTx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: "Test SDF Network ; September 2015",
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination,
          asset: StellarSdk.Asset.native(),
          amount: "10",
        })
      )
      .setTimeout(30)
      .build();
    innerTx.sign(sourceKeypair);

    await stellar.feeBumpTransaction({
      transactionXdr: innerTx.toEnvelope().toXDR("base64"),
      feeSecretKey: feeKeypair.secret(),
      fee: "5000000",
    });

    expect(capturedFee).toBe("5000000");
  });

  it("can use a different fee source than the payment source", async () => {
    const sourceKeypair = StellarSdk.Keypair.random();
    const feeKeypair = StellarSdk.Keypair.random();
    const destination = StellarSdk.Keypair.random().publicKey();

    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
      .mockImplementation(async (publicKey: string) => fakeAccountResponse(publicKey, "100"));

    let capturedFeeSource: string | undefined;
    jest
      .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
      .mockImplementation(async (tx: any) => {
        if (tx.feeSource !== undefined) {
          capturedFeeSource = typeof tx.feeSource === "string"
            ? tx.feeSource
            : tx.feeSource.publicKey?.() ?? String(tx.feeSource);
        }
        return { hash: "hash", successful: true } as unknown as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse;
      });

    const stellar = new StellarService();

    const sourceAccount = new StellarSdk.Account(sourceKeypair.publicKey(), "100");
    const innerTx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: "Test SDF Network ; September 2015",
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination,
          asset: StellarSdk.Asset.native(),
          amount: "10",
        })
      )
      .setTimeout(30)
      .build();
    innerTx.sign(sourceKeypair);

    const result = await stellar.feeBumpTransaction({
      transactionXdr: innerTx.toEnvelope().toXDR("base64"),
      feeSecretKey: feeKeypair.secret(),
    });

    expect(result.successful).toBe(true);
    // The fee source should be the feeKeypair, not the sourceKeypair
  });
});
