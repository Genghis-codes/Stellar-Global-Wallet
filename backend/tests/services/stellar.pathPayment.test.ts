import * as StellarSdk from "@stellar/stellar-sdk";
import { StellarService } from "../../src/services/stellar";

function fakeAccountResponse(publicKey: string, sequence: string) {
  return new StellarSdk.Account(publicKey, sequence) as unknown as StellarSdk.Horizon.AccountResponse;
}

const destinationAsset = `USDC:${StellarSdk.Keypair.random().publicKey()}`;
const pathAsset = `BTCN:${StellarSdk.Keypair.random().publicKey()}`;

describe("StellarService path payments (issue #7)", () => {
  afterEach(() => jest.restoreAllMocks());

  describe("pathPaymentStrictSend", () => {
    it("submits a strict-send path payment transaction", async () => {
      const submittedXdr: string[] = [];

      jest
        .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
        .mockImplementation(async (publicKey: string) => fakeAccountResponse(publicKey, "100"));

      jest
        .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
        .mockImplementation(async (tx: StellarSdk.Transaction) => {
          submittedXdr.push(tx.toXDR());
          return { hash: "path-hash-1", successful: true } as unknown as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse;
        });

      const stellar = new StellarService();
      const result = await stellar.pathPaymentStrictSend({
        sourceSecretKey: StellarSdk.Keypair.random().secret(),
        destinationPublicKey: StellarSdk.Keypair.random().publicKey(),
        sendAmount: "10",
        destAsset: destinationAsset,
        destMin: "9",
        path: [pathAsset],
      });

      expect(result.hash).toBe("path-hash-1");
      expect(result.successful).toBe(true);
      expect(submittedXdr).toHaveLength(1);
    });

    it("retries on tx_bad_seq", async () => {
      let submitCalls = 0;

      jest
        .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
        .mockImplementation(async (publicKey: string) => fakeAccountResponse(publicKey, "100"));

      jest
        .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
        .mockImplementation(async () => {
          submitCalls++;
          if (submitCalls === 1) {
            throw new StellarSdk.BadResponseError("fail", {
              type: "https://stellar.org/horizon-errors/transaction_failed",
              title: "Transaction Failed",
              status: 400,
              extras: { result_codes: { transaction: "tx_bad_seq" }, result_xdr: "" },
            });
          }
          return { hash: "retry-ok", successful: true } as unknown as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse;
        });

      const stellar = new StellarService();
      const result = await stellar.pathPaymentStrictSend({
        sourceSecretKey: StellarSdk.Keypair.random().secret(),
        destinationPublicKey: StellarSdk.Keypair.random().publicKey(),
        sendAmount: "10",
        destAsset: "XLM",
        destMin: "9",
      });

      expect(result.hash).toBe("retry-ok");
      expect(submitCalls).toBe(2);
    });
  });

  describe("pathPaymentStrictReceive", () => {
    it("submits a strict-receive path payment transaction", async () => {
      const submittedXdr: string[] = [];

      jest
        .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
        .mockImplementation(async (publicKey: string) => fakeAccountResponse(publicKey, "100"));

      jest
        .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
        .mockImplementation(async (tx: StellarSdk.Transaction) => {
          submittedXdr.push(tx.toXDR());
          return { hash: "path-hash-2", successful: true } as unknown as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse;
        });

      const stellar = new StellarService();
      const result = await stellar.pathPaymentStrictReceive({
        sourceSecretKey: StellarSdk.Keypair.random().secret(),
        destinationPublicKey: StellarSdk.Keypair.random().publicKey(),
        destAmount: "5",
        destAsset: destinationAsset,
        sendMax: "6",
      });

      expect(result.hash).toBe("path-hash-2");
      expect(result.successful).toBe(true);
      expect(submittedXdr).toHaveLength(1);
    });

    it("retries on tx_bad_seq", async () => {
      let submitCalls = 0;

      jest
        .spyOn(StellarSdk.Horizon.Server.prototype, "loadAccount")
        .mockImplementation(async (publicKey: string) => fakeAccountResponse(publicKey, "100"));

      jest
        .spyOn(StellarSdk.Horizon.Server.prototype, "submitTransaction")
        .mockImplementation(async () => {
          submitCalls++;
          if (submitCalls === 1) {
            throw new StellarSdk.BadResponseError("fail", {
              type: "https://stellar.org/horizon-errors/transaction_failed",
              title: "Transaction Failed",
              status: 400,
              extras: { result_codes: { transaction: "tx_bad_seq" }, result_xdr: "" },
            });
          }
          return { hash: "retry-ok", successful: true } as unknown as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse;
        });

      const stellar = new StellarService();
      const result = await stellar.pathPaymentStrictReceive({
        sourceSecretKey: StellarSdk.Keypair.random().secret(),
        destinationPublicKey: StellarSdk.Keypair.random().publicKey(),
        destAmount: "5",
        destAsset: destinationAsset,
        sendMax: "6",
      });

      expect(result.hash).toBe("retry-ok");
      expect(submitCalls).toBe(2);
    });
  });

  // Issue #81: findStrictSendPaths/findStrictReceivePaths must be tested
  // against the real SDK method boundary — Horizon.Server#strictSendPaths /
  // #strictReceivePaths — not a stand-in like `.paths()` (which doesn't
  // exist on Horizon.Server at all, see issue #70). Mocking the prototype
  // method by its real name below means a test suite here can only stay
  // green if the implementation calls the real method; calling the wrong
  // one would leave these spies unhit and the calls would throw.
  describe("findStrictSendPaths", () => {
    it("falls back to destination asset list when destinationPublicKey is omitted", async () => {
      const mockCall = jest.fn().mockResolvedValue({ records: [] });
      const mockLimit = jest.fn().mockReturnValue({ call: mockCall });
      const mockStrictSendPaths = jest.fn().mockReturnValue({ limit: mockLimit });

      jest.spyOn(StellarSdk.Horizon.Server.prototype, "strictSendPaths").mockImplementation(mockStrictSendPaths as any);

      const stellar = new StellarService();
      await stellar.findStrictSendPaths({
        sourceAmount: "10",
        destinationAsset: destinationAsset,
        // destinationPublicKey omitted
      });

      expect(mockStrictSendPaths).toHaveBeenCalledWith(
        expect.any(StellarSdk.Asset), // srcAsset
        "10", // sourceAmount
        expect.arrayContaining([expect.any(StellarSdk.Asset)]) // destination
      );
      
      const args = mockStrictSendPaths.mock.calls[0];
      expect(Array.isArray(args[2])).toBe(true);
      expect(args[2][0].code).toBe("USDC");
    });
  });

  describe("findStrictReceivePaths", () => {
    it("falls back to source asset list when destinationPublicKey is omitted", async () => {
      const mockCall = jest.fn().mockResolvedValue({ records: [] });
      const mockLimit = jest.fn().mockReturnValue({ call: mockCall });
      const mockStrictReceivePaths = jest.fn().mockReturnValue({ limit: mockLimit });

      jest.spyOn(StellarSdk.Horizon.Server.prototype, "strictReceivePaths").mockImplementation(mockStrictReceivePaths as any);

      const stellar = new StellarService();
      await stellar.findStrictReceivePaths({
        destinationAmount: "10",
        destinationAsset: destinationAsset,
        // destinationPublicKey omitted
      });

      expect(mockStrictReceivePaths).toHaveBeenCalledWith(
        expect.arrayContaining([expect.any(StellarSdk.Asset)]), // source
        expect.any(StellarSdk.Asset), // destAst
        "10" // destinationAmount
      );

      const args = mockStrictReceivePaths.mock.calls[0];
      expect(Array.isArray(args[0])).toBe(true);
      expect(args[0][0].isNative()).toBe(true);
    });
  });
});
