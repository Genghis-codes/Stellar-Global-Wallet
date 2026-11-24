import { TransactionSubmitter, MAX_SEQ_RETRIES, RETRY_BASE_DELAY_MS, PATH_EXPIRED_OPERATION_CODES } from "../services/transactionSubmitter";
import { HorizonService } from "../services/horizonService";
import { InProcessAccountLock } from "../services/locks/accountLock";
import { BuiltTransactionRegistry, InMemoryBuiltTransactionStore } from "../services/builtTransactions";
import * as StellarSdk from "@stellar/stellar-sdk";

describe("TransactionSubmitter", () => {
  const sourceSecretKey = "SBQXD34J66P3VJ2T5J6V7X7W7Y7Z7X7W7Y7Z7X7W7Y7Z7X7W7Y7Z7X7W";
  const destinationPublicKey = "GAXE5L3B3T5Z4X6Y7Z8X9Y0Z1X2Y3Z4X5Y6Z7X8Y9Z0";
  const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecretKey);

  let horizonService: HorizonService;
  let accountLock: InProcessAccountLock;
  let builtTxs: BuiltTransactionRegistry | null;
  let submitter: TransactionSubmitter;

  beforeEach(() => {
    // Create a mock horizon service
    const mockServer = {
      loadAccount: jest.fn(),
      submitTransaction: jest.fn(),
      fetchBaseFee: jest.fn().mockResolvedValue(100),
      transactions: () => ({
        transaction: () => ({
          call: jest.fn(),
        }),
      }),
      operations: () => ({
        forAccount: () => ({
          join: () => ({
            includeFailed: () => ({
              limit: () => ({
                order: () => ({
                  cursor: () => ({
                    call: jest.fn().mockResolvedValue({ records: [] }),
                  }),
                }),
              }),
            }),
          }),
        }),
        forTransaction: () => ({
          includeFailed: () => ({
            limit: () => ({
              call: jest.fn().mockResolvedValue({ records: [] }),
            }),
          }),
        }),
      }),
      payments: () => ({
        forAccount: () => ({
          join: () => ({
            limit: () => ({
              order: () => ({
                cursor: () => ({
                  call: jest.fn().mockResolvedValue({ records: [] }),
                }),
              }),
            }),
          }),
        }),
      }),
    };

    horizonService = new HorizonService({
      server: mockServer as any,
      networkPassphrase: StellarSdk.Networks.PUBLIC,
    });

    accountLock = new InProcessAccountLock();
    builtTxs = null;
    submitter = new TransactionSubmitter({
      horizonService,
      accountLock,
      builtTransactionRegistry: builtTxs,
    });
  });

  describe("sendPayment", () => {
    it("submits a payment transaction successfully", async () => {
      const submitMock = jest.spyOn((horizonService as any).server, "submitTransaction");
      submitMock.mockResolvedValue({
        hash: "test-hash",
        ledger: 12345,
        successful: true,
      });

      const loadAccountMock = jest.spyOn((horizonService as any).server, "loadAccount");
      loadAccountMock.mockResolvedValue({
        accountId: sourceKeypair.publicKey(),
        sequence: "1234567890123456",
        balance: "1000",
        max_spendable: "1000",
        thresholds: { low_threshold: 0, medium_threshold: 0, high_threshold: 0 },
        signers: [],
        data: {},
      });

      const result = await submitter.sendPayment({
        sourceSecretKey,
        destinationPublicKey,
        amount: "10",
      });

      expect(result).toEqual({ hash: "test-hash", ledger: 12345, successful: true });
      expect(submitMock).toHaveBeenCalledTimes(1);
    });

    it("retries on tx_bad_seq error", async () => {
      const submitMock = jest.spyOn((horizonService as any).server, "submitTransaction");
      const loadAccountMock = jest.spyOn((horizonService as any).server, "loadAccount");

      // First attempt fails with tx_bad_seq
      submitMock.mockImplementationOnce(() => {
        throw {
          response: {
            extras: {
              result_codes: { transaction: "tx_bad_seq" },
            },
          },
        };
      });

      // Second attempt succeeds
      submitMock.mockResolvedValue({
        hash: "test-hash",
        ledger: 12346,
        successful: true,
      });

      loadAccountMock.mockResolvedValue({
        accountId: sourceKeypair.publicKey(),
        sequence: "1234567890123457", // New sequence
        balance: "1000",
        max_spendable: "1000",
        thresholds: { low_threshold: 0, medium_threshold: 0, high_threshold: 0 },
        signers: [],
        data: {},
      });

      const result = await submitter.sendPayment({
        sourceSecretKey,
        destinationPublicKey,
        amount: "10",
      });

      expect(result).toEqual({ hash: "test-hash", ledger: 12346, successful: true });
      expect(submitMock).toHaveBeenCalledTimes(2);
    });

    it("throws after max retries", async () => {
      const submitMock = jest.spyOn((horizonService as any).server, "submitTransaction");
      const loadAccountMock = jest.spyOn((horizonService as any).server, "loadAccount");

      // Always fail with tx_bad_seq
      submitMock.mockImplementation(() => {
        throw {
          response: {
            extras: {
              result_codes: { transaction: "tx_bad_seq" },
            },
          },
        };
      });

      loadAccountMock.mockResolvedValue({
        accountId: sourceKeypair.publicKey(),
        sequence: "1234567890123456",
        balance: "1000",
        max_spendable: "1000",
        thresholds: { low_threshold: 0, medium_threshold: 0, high_threshold: 0 },
        signers: [],
        data: {},
      });

      await expect(
        submitter.sendPayment({
          sourceSecretKey,
          destinationPublicKey,
          amount: "10",
        })
      ).rejects.toThrow();

      expect(submitMock).toHaveBeenCalledTimes(MAX_SEQ_RETRIES + 1);
    });

    it("handles gateway timeout (504) with pending status", async () => {
      const submitMock = jest.spyOn((horizonService as any).server, "submitTransaction");
      submitMock.mockRejectedValue({
        response: {
          status: 504,
        },
      });

      const loadAccountMock = jest.spyOn((horizonService as any).server, "loadAccount");
      loadAccountMock.mockResolvedValue({
        accountId: sourceKeypair.publicKey(),
        sequence: "1234567890123456",
        balance: "1000",
        max_spendable: "1000",
        thresholds: { low_threshold: 0, medium_threshold: 0, high_threshold: 0 },
        signers: [],
        data: {},
      });

      const result = await submitter.sendPayment({
        sourceSecretKey,
        destinationPublicKey,
        amount: "10",
      });

      expect(result).toMatchObject({ hash: expect.any(String), status: "pending" });
    });

    it("validates memo requirement (SEP-29)", async () => {
      const loadAccountMock = jest.spyOn((horizonService as any).server, "loadAccount");
      
      // Account requires memo
      loadAccountMock.mockResolvedValue({
        accountId: destinationPublicKey,
        sequence: "1234567890123456",
        balance: "1000",
        max_spendable: "1000",
        thresholds: { low_threshold: 0, medium_threshold: 0, high_threshold: 0 },
        signers: [],
        data: { "config.memo_required": "MQ==" },
      });

      await expect(
        submitter.sendPayment({
          sourceSecretKey,
          destinationPublicKey,
          amount: "10",
          // No memo provided
        })
      ).rejects.toMatchObject({
        code: "MEMO_REQUIRED",
      });

      expect(submitMock).not.toHaveBeenCalled();
    });
  });

  describe("pathPaymentStrictSend", () => {
    it("submits a path payment transaction successfully", async () => {
      const submitMock = jest.spyOn((horizonService as any).server, "submitTransaction");
      submitMock.mockResolvedValue({
        hash: "path-payment-hash",
        ledger: 12347,
        successful: true,
      });

      const loadAccountMock = jest.spyOn((horizonService as any).server, "loadAccount");
      loadAccountMock.mockResolvedValue({
        accountId: sourceKeypair.publicKey(),
        sequence: "1234567890123456",
        balance: "1000",
        max_spendable: "1000",
        thresholds: { low_threshold: 0, medium_threshold: 0, high_threshold: 0 },
        signers: [],
        data: {},
      });

      const result = await submitter.pathPaymentStrictSend({
        sourceSecretKey,
        sendAsset: "XLM",
        sendAmount: "10",
        destinationPublicKey,
        destAsset: "USD:G...",
        destMin: "5",
        path: [],
      });

      expect(result).toEqual({ hash: "path-payment-hash", ledger: 12347, successful: true });
      expect(submitMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("pathPaymentStrictReceive", () => {
    it("submits a path payment strict receive transaction successfully", async () => {
      const submitMock = jest.spyOn((horizonService as any).server, "submitTransaction");
      submitMock.mockResolvedValue({
        hash: "path-receive-hash",
        ledger: 12348,
        successful: true,
      });

      const loadAccountMock = jest.spyOn((horizonService as any).server, "loadAccount");
      loadAccountMock.mockResolvedValue({
        accountId: sourceKeypair.publicKey(),
        sequence: "1234567890123456",
        balance: "1000",
        max_spendable: "1000",
        thresholds: { low_threshold: 0, medium_threshold: 0, high_threshold: 0 },
        signers: [],
        data: {},
      });

      const result = await submitter.pathPaymentStrictReceive({
        sourceSecretKey,
        sendAsset: "XLM",
        sendMax: "15",
        destinationPublicKey,
        destAsset: "USD:G...",
        destAmount: "10",
        path: [],
      });

      expect(result).toEqual({ hash: "path-receive-hash", ledger: 12348, successful: true });
      expect(submitMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("submitSigned", () => {
    it("submits a pre-built signed transaction successfully", async () => {
      const tx = new StellarSdk.TransactionBuilder(
        {
          accountId: sourceKeypair.publicKey(),
          sequence: "1234567890123456",
          balance: "1000",
          thresholds: { low_threshold: 0, medium_threshold: 0, high_threshold: 0 },
          signers: [],
          data: {},
        },
        { fee: 100, networkPassphrase: StellarSdk.Networks.PUBLIC }
      )
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationPublicKey,
            amount: "10",
          })
        )
        .setTimeout(180)
        .build();

      tx.sign(sourceKeypair);

      const submitMock = jest.spyOn((horizonService as any).server, "submitTransaction");
      submitMock.mockResolvedValue({
        hash: Buffer.from(tx.hash()).toString("hex"),
        ledger: 12349,
        successful: true,
      });

      const result = await submitter.submitSigned({ signedXdr: tx.toXDR() });

      expect(result).toEqual({
        hash: Buffer.from(tx.hash()).toString("hex"),
        ledger: 12349,
        successful: true,
      });
    });

    it("rejects invalid XDR", async () => {
      await expect(submitter.submitSigned({ signedXdr: "not-valid-xdr" })).rejects.toThrow("Invalid transaction XDR");
    });

    it("handles gateway timeout with pending status", async () => {
      const submitMock = jest.spyOn((horizonService as any).server, "submitTransaction");
      submitMock.mockRejectedValue({ response: { status: 504 } });

      const tx = new StellarSdk.TransactionBuilder(
        {
          accountId: sourceKeypair.publicKey(),
          sequence: "1234567890123456",
          balance: "1000",
          thresholds: { low_threshold: 0, medium_threshold: 0, high_threshold: 0 },
          signers: [],
          data: {},
        },
        { fee: 100, networkPassphrase: StellarSdk.Networks.PUBLIC }
      )
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationPublicKey,
            amount: "10",
          })
        )
        .setTimeout(180)
        .build();

      tx.sign(sourceKeypair);

      const result = await submitter.submitSigned({ signedXdr: tx.toXDR() });

      expect(result).toMatchObject({ hash: expect.any(String), status: "pending" });
    });
  });

  describe("constants", () => {
    it("exports MAX_SEQ_RETRIES", () => {
      expect(MAX_SEQ_RETRIES).toBe(3);
    });

    it("exports RETRY_BASE_DELAY_MS", () => {
      expect(RETRY_BASE_DELAY_MS).toBe(200);
    });

    it("exports PATH_EXPIRED_OPERATION_CODES", () => {
      expect(PATH_EXPIRED_OPERATION_CODES).toEqual([
        "op_too_few_offers",
        "op_under_dest_min",
        "op_over_source_max",
      ]);
    });
  });
});
