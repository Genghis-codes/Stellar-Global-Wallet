import * as StellarSdk from "@stellar/stellar-sdk";
import { StellarService } from "../../src/services/stellar";

function fakeAccountResponse(publicKey: string, sequence: string) {
  return new StellarSdk.Account(publicKey, sequence) as unknown as StellarSdk.Horizon.AccountResponse;
}

describe("StellarService multi-signature (issue #8)", () => {
  afterEach(() => jest.restoreAllMocks());

  describe("buildPartialTransaction", () => {
    it("returns base64 XDR and transaction hash", async () => {
      jest
        .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
        .mockImplementation(async (publicKey: string) => fakeAccountResponse(publicKey, "100"));

      const stellar = new StellarService();
      const keypair = StellarSdk.Keypair.random();
      const result = await stellar.buildPartialTransaction({
        sourceSecretKey: keypair.secret(),
        destinationPublicKey: StellarSdk.Keypair.random().publicKey(),
        amount: "10",
      });

      expect(typeof result.xdr).toBe("string");
      expect(result.xdr.length).toBeGreaterThan(0);
      expect(typeof result.hash).toBe("string");
      expect(result.hash.length).toBe(64); // SHA-256 hex
    });

    it("produces valid XDR that can be deserialized with the network passphrase", async () => {
      jest
        .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
        .mockImplementation(async (publicKey: string) => fakeAccountResponse(publicKey, "100"));

      const stellar = new StellarService();
      const keypair = StellarSdk.Keypair.random();
      const { xdr } = await stellar.buildPartialTransaction({
        sourceSecretKey: keypair.secret(),
        destinationPublicKey: StellarSdk.Keypair.random().publicKey(),
        amount: "10",
      });

      // Deserializing the XDR must not throw
      const tx = new StellarSdk.Transaction(
        xdr,
        StellarSdk.Networks.TESTNET
      );
      expect(tx.operations).toHaveLength(1);
    });
  });

  describe("submitWithAdditionalSignatures", () => {
    it("adds signatures and submits to Horizon", async () => {
      const sourceKeypair = StellarSdk.Keypair.random();
      const cosignerKeypair = StellarSdk.Keypair.random();

      jest
        .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
        .mockImplementation(async (publicKey: string) => fakeAccountResponse(publicKey, "100"));

      let submittedTx: StellarSdk.Transaction | undefined;
      jest
        .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
        .mockImplementation(async (tx: StellarSdk.Transaction) => {
          submittedTx = tx;
          return { hash: "multisig-hash", successful: true } as unknown as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse;
        });

      const stellar = new StellarService();

      // Build and partially sign
      const { xdr } = await stellar.buildPartialTransaction({
        sourceSecretKey: sourceKeypair.secret(),
        destinationPublicKey: StellarSdk.Keypair.random().publicKey(),
        amount: "5",
      });

      // Add cosigner signature and submit
      const result = await stellar.submitWithAdditionalSignatures({
        xdr,
        signerSecretKeys: [cosignerKeypair.secret()],
      });

      expect(result.hash).toBe("multisig-hash");
      expect(result.successful).toBe(true);
      // Transaction should have 2 signatures
      expect(submittedTx!.signatures).toHaveLength(2);
    });

    it("supports adding multiple co-signer signatures", async () => {
      const sourceKeypair = StellarSdk.Keypair.random();
      const cosigner1 = StellarSdk.Keypair.random();
      const cosigner2 = StellarSdk.Keypair.random();

      jest
        .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
        .mockImplementation(async (publicKey: string) => fakeAccountResponse(publicKey, "100"));

      let submittedTx: StellarSdk.Transaction | undefined;
      jest
        .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
        .mockImplementation(async (tx: StellarSdk.Transaction) => {
          submittedTx = tx;
          return { hash: "multisig-2hash", successful: true } as unknown as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse;
        });

      const stellar = new StellarService();
      const { xdr } = await stellar.buildPartialTransaction({
        sourceSecretKey: sourceKeypair.secret(),
        destinationPublicKey: StellarSdk.Keypair.random().publicKey(),
        amount: "5",
      });

      const result = await stellar.submitWithAdditionalSignatures({
        xdr,
        signerSecretKeys: [cosigner1.secret(), cosigner2.secret()],
      });

      expect(result.successful).toBe(true);
      expect(submittedTx!.signatures).toHaveLength(3); // source + 2 co-signers
    });
  });

  describe("getAccountThresholds", () => {
    it("returns threshold values and signer list", async () => {
      const mockAccount = {
        thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
        signers: [
          { key: "GABC...", weight: 1 },
          { key: "GDEF...", weight: 2 },
        ],
      };

      jest
        .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
        .mockImplementation(async (publicKey: string) => {
          return { ...fakeAccountResponse(publicKey, "100"), ...mockAccount } as unknown as StellarSdk.Horizon.AccountResponse;
        });

      const stellar = new StellarService();
      const result = await stellar.getAccountThresholds(
        StellarSdk.Keypair.random().publicKey()
      );

      expect(result.lowThreshold).toBe(1);
      expect(result.mediumThreshold).toBe(2);
      expect(result.highThreshold).toBe(3);
      expect(result.signers).toHaveLength(2);
    });
  });
});
