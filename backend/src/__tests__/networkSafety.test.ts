import * as StellarSdk from "@stellar/stellar-sdk";
import { scopedKey } from "../utils/networkScope";
import { KNOWN_PASSPHRASES } from "../utils/networkCheck";
import { parseSignedTransaction, assertSignedForThisNetwork } from "../services/transactionEnvelope";
import { InvalidTransactionError } from "../errors/appError";

describe("Multi-Network Safety (#223)", () => {
  it("generates network-scoped Redis keys", () => {
    expect(scopedKey("json-cache:stellar.toml", "testnet")).toBe("orbit-wal:testnet:json-cache:stellar.toml");
    expect(scopedKey("json-cache:stellar.toml", "mainnet")).toBe("orbit-wal:mainnet:json-cache:stellar.toml");
    expect(scopedKey("orbit-wal:soroban-cache:key", "testnet")).toBe("orbit-wal:testnet:soroban-cache:key");
  });

  it("rejects an envelope signed for a different network passphrase", () => {
    const keypair = StellarSdk.Keypair.random();
    const sourceAccount = new StellarSdk.Account(keypair.publicKey(), "100");

    // Build and sign for MAINNET
    const mainnetTx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: KNOWN_PASSPHRASES.mainnet,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: StellarSdk.Keypair.random().publicKey(),
          asset: StellarSdk.Asset.native(),
          amount: "10",
        })
      )
      .setTimeout(300)
      .build();

    mainnetTx.sign(keypair);
    const mainnetXdr = mainnetTx.toXDR();

    // Attempting to parse/validate this transaction against TESTNET must fail with WRONG_NETWORK
    expect(() => {
      parseSignedTransaction(mainnetXdr, KNOWN_PASSPHRASES.testnet);
    }).toThrow(InvalidTransactionError);

    try {
      parseSignedTransaction(mainnetXdr, KNOWN_PASSPHRASES.testnet);
    } catch (err) {
      expect((err as InvalidTransactionError).code).toBe("WRONG_NETWORK");
    }
  });

  it("accepts an envelope signed for the matching network passphrase", () => {
    const keypair = StellarSdk.Keypair.random();
    const sourceAccount = new StellarSdk.Account(keypair.publicKey(), "100");

    const testnetTx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: KNOWN_PASSPHRASES.testnet,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: StellarSdk.Keypair.random().publicKey(),
          asset: StellarSdk.Asset.native(),
          amount: "10",
        })
      )
      .setTimeout(300)
      .build();

    testnetTx.sign(keypair);
    const testnetXdr = testnetTx.toXDR();

    const parsed = parseSignedTransaction(testnetXdr, KNOWN_PASSPHRASES.testnet);
    expect(parsed.hash).toBe(Buffer.from(testnetTx.hash()).toString("hex"));
    expect(parsed.sourcePublicKey).toBe(keypair.publicKey());
  });
});
