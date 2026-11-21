import * as StellarSdk from "@stellar/stellar-sdk";
import request from "supertest";
import { createApp } from "../../src/app";
import { SorobanService } from "../../src/services/soroban";
import { StellarService, accountRequiresMemo } from "../../src/services/stellar";
import {
  MAX_UPSTREAM_PAGE_RECORDS,
  UpstreamResponseTooLargeError,
  UpstreamValidationError,
  installUpstreamHttpGuards,
} from "../../src/services/upstreamValidation";
import { signedPayment } from "../helpers/signedTx";
import * as sorobanCache from "../../src/services/sorobanCache";

const { Horizon, rpc } = StellarSdk;

function validHorizonAccount(
  publicKey: string,
  extra: Record<string, unknown> = {}
): StellarSdk.Horizon.AccountResponse {
  return Object.assign(
    new StellarSdk.Account(publicKey, "100"),
    extra
  ) as unknown as StellarSdk.Horizon.AccountResponse;
}

describe("Upstream Horizon & Soroban RPC response validation (#294)", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(sorobanCache, "getCachedSimulate").mockResolvedValue(null);
    jest.spyOn(sorobanCache, "setCachedSimulate").mockResolvedValue(undefined);
    jest.spyOn(sorobanCache, "markPendingTransaction").mockResolvedValue(undefined);
    jest.spyOn(sorobanCache, "clearPendingTransaction").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Horizon malformed fixtures (StellarService)", () => {
    it("rejects loadAccount responses missing SDK Account methods or carrying an invalid StrKey", async () => {
      const stellar = new StellarService();
      const pub = StellarSdk.Keypair.random().publicKey();

      jest
        .spyOn(Horizon.Server.prototype, "loadAccount")
        .mockResolvedValueOnce({ account_id: pub } as unknown as StellarSdk.Horizon.AccountResponse);

      await expect(stellar.getAccount(pub)).rejects.toMatchObject({
        code: "HORIZON_ERROR",
        status: 502,
        retryable: false,
        upstream: "horizon",
        operation: "loadAccount",
      });

      jest.spyOn(Horizon.Server.prototype, "loadAccount").mockResolvedValueOnce({
        accountId: () => "NOT_A_VALID_G_ADDRESS",
        sequenceNumber: () => "100",
        incrementSequenceNumber: () => undefined,
      } as unknown as StellarSdk.Horizon.AccountResponse);

      await expect(stellar.getAccount(pub)).rejects.toBeInstanceOf(UpstreamValidationError);
    });

    it("rejects loadAccount responses with non-integer sequence numbers or mismatched account_id", async () => {
      const stellar = new StellarService();
      const pub = StellarSdk.Keypair.random().publicKey();
      const other = StellarSdk.Keypair.random().publicKey();

      jest.spyOn(Horizon.Server.prototype, "loadAccount").mockResolvedValueOnce({
        accountId: () => pub,
        sequenceNumber: () => "-42",
        incrementSequenceNumber: () => undefined,
      } as unknown as StellarSdk.Horizon.AccountResponse);

      await expect(stellar.getAccount(pub)).rejects.toBeInstanceOf(UpstreamValidationError);

      jest
        .spyOn(Horizon.Server.prototype, "loadAccount")
        .mockResolvedValueOnce(validHorizonAccount(pub, { account_id: other }));

      await expect(stellar.getAccount(pub)).rejects.toBeInstanceOf(UpstreamValidationError);
    });

    it("rejects getBalances and buildTrustlineTransaction when balances or reserves are malformed", async () => {
      const stellar = new StellarService();
      const pub = StellarSdk.Keypair.random().publicKey();
      const issuer = StellarSdk.Keypair.random().publicKey();

      // Missing balances array on getBalances
      jest
        .spyOn(Horizon.Server.prototype, "loadAccount")
        .mockResolvedValueOnce(validHorizonAccount(pub));
      await expect(stellar.getBalances(pub)).rejects.toBeInstanceOf(UpstreamValidationError);

      // Non-decimal balance string
      jest.spyOn(Horizon.Server.prototype, "loadAccount").mockResolvedValueOnce(
        validHorizonAccount(pub, {
          balances: [{ asset_type: "native", balance: "NaN" }],
        })
      );
      await expect(stellar.getBalances(pub)).rejects.toBeInstanceOf(UpstreamValidationError);

      // Credit balance missing checksummed issuer
      jest.spyOn(Horizon.Server.prototype, "loadAccount").mockResolvedValueOnce(
        validHorizonAccount(pub, {
          balances: [
            {
              asset_type: "credit_alphanum4",
              asset_code: "USDC",
              asset_issuer: "BAD_ISSUER",
              balance: "10.0000000",
            },
          ],
        })
      );
      await expect(stellar.getBalances(pub)).rejects.toBeInstanceOf(UpstreamValidationError);

      // Negative subentry_count on buildTrustlineTransaction
      jest.spyOn(Horizon.Server.prototype, "loadAccount").mockImplementation(async (id: string) => {
        if (id === issuer) return validHorizonAccount(issuer);
        return validHorizonAccount(pub, {
          balances: [{ asset_type: "native", balance: "10.0000000" }],
          subentry_count: -1,
        });
      });
      await expect(
        stellar.buildTrustlineTransaction({
          account: pub,
          asset: { code: "USDC", issuer },
        })
      ).rejects.toBeInstanceOf(UpstreamValidationError);
    });

    it("fails closed in destinationRequiresMemo and accountRequiresMemo on malformed SEP-29 data_attr", async () => {
      const stellar = new StellarService();
      const source = StellarSdk.Keypair.random();
      const destination = StellarSdk.Keypair.random().publicKey();

      jest.spyOn(Horizon.Server.prototype, "loadAccount").mockResolvedValue(
        validHorizonAccount(destination, {
          data_attr: { "config.memo_required": 1 as unknown as string },
        })
      );

      // Must NOT swallow the validation error and return false (which would risk fund loss)
      await expect(stellar.destinationRequiresMemo(destination)).rejects.toBeInstanceOf(
        UpstreamValidationError
      );
      await expect(
        stellar.sendPayment({
          sourceSecretKey: source.secret(),
          destinationPublicKey: destination,
          amount: "5",
        })
      ).rejects.toBeInstanceOf(UpstreamValidationError);

      expect(() =>
        accountRequiresMemo({
          data_attr: ["not-a-map"],
        } as unknown as StellarSdk.Horizon.AccountResponse)
      ).toThrow(UpstreamValidationError);
    });

    it("fails closed in buildPayment when fetchBaseFee returns a non-positive or non-integer value", async () => {
      const stellar = new StellarService();
      const source = StellarSdk.Keypair.random().publicKey();
      const destination = StellarSdk.Keypair.random().publicKey();

      jest
        .spyOn(Horizon.Server.prototype, "loadAccount")
        .mockImplementation(async (id: string) => validHorizonAccount(id));
      jest
        .spyOn(Horizon.Server.prototype, "fetchBaseFee")
        .mockResolvedValueOnce(Number.NaN);

      await expect(
        stellar.buildPayment({
          sourcePublicKey: source,
          destinationPublicKey: destination,
          amount: "10",
        })
      ).rejects.toBeInstanceOf(UpstreamValidationError);
    });

    it("rejects malformed submitTransaction responses instead of returning corrupt data", async () => {
      const stellar = new StellarService();
      const { xdr: signedXdr } = signedPayment();

      jest.spyOn(Horizon.Server.prototype, "submitTransaction").mockResolvedValueOnce({
        hash: "",
        successful: true,
      } as unknown as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse);
      await expect(stellar.submitSigned({ signedXdr })).rejects.toBeInstanceOf(
        UpstreamValidationError
      );

      jest.spyOn(Horizon.Server.prototype, "submitTransaction").mockResolvedValueOnce({
        hash: "valid-hash",
        successful: "true",
      } as unknown as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse);
      await expect(stellar.submitSigned({ signedXdr })).rejects.toBeInstanceOf(
        UpstreamValidationError
      );
    });

    it("rejects malformed getAccountThresholds responses when thresholds or signers are invalid", async () => {
      const stellar = new StellarService();
      const pub = StellarSdk.Keypair.random().publicKey();

      // Missing thresholds object
      jest
        .spyOn(Horizon.Server.prototype, "loadAccount")
        .mockResolvedValueOnce(validHorizonAccount(pub));
      await expect(stellar.getAccountThresholds(pub)).rejects.toBeInstanceOf(
        UpstreamValidationError
      );

      // Out-of-bounds threshold > 255
      jest.spyOn(Horizon.Server.prototype, "loadAccount").mockResolvedValueOnce(
        validHorizonAccount(pub, {
          thresholds: { low_threshold: 0, med_threshold: 300, high_threshold: 255 },
        })
      );
      await expect(stellar.getAccountThresholds(pub)).rejects.toBeInstanceOf(
        UpstreamValidationError
      );
    });

    it("rejects malformed transaction pages, payment pages, joined transactions, and path quotes", async () => {
      const stellar = new StellarService();
      const pub = StellarSdk.Keypair.random().publicKey();
      const issuer = StellarSdk.Keypair.random().publicKey();

      // Malformed /transactions page (invalid timestamp)
      jest.spyOn(Horizon.Server.prototype, "transactions").mockReturnValueOnce({
        forAccount: () => ({
          limit: () => ({
            order: () => ({
              call: async () => ({
                records: [
                  {
                    id: "1",
                    paging_token: "pt-1",
                    hash: "h1",
                    ledger_attr: 10,
                    created_at: "not-a-timestamp",
                    operation_count: 1,
                  },
                ],
              }),
            }),
          }),
        }),
      } as unknown as ReturnType<StellarSdk.Horizon.Server["transactions"]>);

      await expect(stellar.getTransactions(pub)).rejects.toBeInstanceOf(UpstreamValidationError);

      // Malformed joined parent transaction in /payments
      jest.spyOn(Horizon.Server.prototype, "payments").mockReturnValueOnce({
        forAccount: () => ({
          join: () => ({
            limit: () => ({
              order: () => ({
                call: async () => ({
                  records: [
                    {
                      id: "op-1",
                      paging_token: "pt-1",
                      type: "payment",
                      transaction_hash: "tx-1",
                      created_at: "2026-10-17T10:00:00Z",
                      amount: "10.0000000",
                      asset_type: "native",
                      transaction: async () => ({ memo: 12345 }),
                    },
                  ],
                }),
              }),
            }),
          }),
        }),
      } as unknown as ReturnType<StellarSdk.Horizon.Server["payments"]>);

      await expect(stellar.getPaymentHistory(pub)).rejects.toBeInstanceOf(UpstreamValidationError);

      // Malformed path quote (non-native hop missing asset_issuer)
      jest.spyOn(Horizon.Server.prototype, "strictSendPaths").mockReturnValueOnce({
        limit: () => ({
          call: async () => ({
            records: [
              {
                source_asset_type: "native",
                source_amount: "10.0000000",
                destination_asset_type: "credit_alphanum4",
                destination_asset_code: "USDC",
                destination_asset_issuer: issuer,
                destination_amount: "9.5000000",
                path: [{ asset_type: "credit_alphanum4", asset_code: "EURT" }],
              },
            ],
          }),
        }),
      } as unknown as ReturnType<StellarSdk.Horizon.Server["strictSendPaths"]>);

      await expect(
        stellar.findStrictSendPaths({
          sourceAmount: "10",
          destinationAsset: `USDC:${issuer}`,
        })
      ).rejects.toBeInstanceOf(UpstreamValidationError);
    });

    it("rejects paginated Horizon responses that exceed MAX_UPSTREAM_PAGE_RECORDS", async () => {
      const stellar = new StellarService();
      const pub = StellarSdk.Keypair.random().publicKey();

      const tooManyRecords = Array.from({ length: MAX_UPSTREAM_PAGE_RECORDS + 1 }, (_, i) => ({
        id: String(i + 1),
        paging_token: String(i + 1),
        hash: `hash-${i}`,
        ledger_attr: 100,
        created_at: "2026-10-17T10:00:00Z",
        operation_count: 1,
      }));

      jest.spyOn(Horizon.Server.prototype, "transactions").mockReturnValueOnce({
        forAccount: () => ({
          limit: () => ({
            order: () => ({
              call: async () => ({ records: tooManyRecords }),
            }),
          }),
        }),
      } as unknown as ReturnType<StellarSdk.Horizon.Server["transactions"]>);

      await expect(stellar.getTransactions(pub)).rejects.toBeInstanceOf(UpstreamValidationError);
    });
  });

  describe("Soroban RPC malformed fixtures (SorobanService)", () => {
    const CONTRACT_ID = "CBGLPMNSM4FWMIZ6FFBSRN7FNVCHCI2SLZNODA27LEOXFPLWNYEAEP3K";

    it("fails closed in simulate, prepareInvocation, and buildUnsignedTransaction when getAccount or simulateTransaction is malformed", async () => {
      const soroban = new SorobanService();
      const user = StellarSdk.Keypair.random().publicKey();

      // Corrupt getAccount response must NOT fall back to sequence "0" or SOROBAN_UNAVAILABLE
      jest.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValueOnce({
        accountId: () => user,
        sequenceNumber: () => "not-an-int",
        incrementSequenceNumber: () => undefined,
      } as unknown as StellarSdk.Account);

      await expect(
        soroban.simulate({
          contractId: CONTRACT_ID,
          method: "get_assets",
          args: [],
          sourcePublicKey: user,
        })
      ).rejects.toMatchObject({
        code: "SOROBAN_ERROR",
        status: 502,
        retryable: false,
        upstream: "soroban_rpc",
        operation: "getAccount",
      });

      // Corrupt simulateTransaction response (non-integer minResourceFee / missing transactionData.build)
      jest
        .spyOn(rpc.Server.prototype, "getAccount")
        .mockResolvedValue(new StellarSdk.Account(user, "10"));
      jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValueOnce({
        id: "1",
        latestLedger: 100,
        minResourceFee: "12.34",
        transactionData: {},
      } as unknown as StellarSdk.rpc.Api.SimulateTransactionResponse);

      await expect(
        soroban.prepareInvocation({
          contractId: CONTRACT_ID,
          method: "record_spend",
          args: [],
          sourcePublicKey: user,
        })
      ).rejects.toBeInstanceOf(UpstreamValidationError);

      jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValueOnce({
        id: "1",
        latestLedger: 100,
        minResourceFee: "100",
        transactionData: new StellarSdk.SorobanDataBuilder(),
        result: { auth: [], retval: { notAnScVal: true } },
      } as unknown as StellarSdk.rpc.Api.SimulateTransactionResponse);

      await expect(
        soroban.buildUnsignedTransaction({
          contractId: CONTRACT_ID,
          method: "record_spend",
          args: [],
          sourcePublicKey: user,
        })
      ).rejects.toBeInstanceOf(UpstreamValidationError);
    });

    it("rejects malformed sendTransaction, getTransaction, and getLatestLedger responses", async () => {
      const soroban = new SorobanService();
      const keypair = StellarSdk.Keypair.random();
      const validHash = "a".repeat(64);

      jest
        .spyOn(rpc.Server.prototype, "getAccount")
        .mockResolvedValue(new StellarSdk.Account(keypair.publicKey(), "10"));
      jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
        id: "1",
        latestLedger: 100,
        events: [],
        _parsed: true,
        transactionData: new StellarSdk.SorobanDataBuilder(),
        minResourceFee: "100",
        cost: { cpuInsns: "0", memBytes: "0" },
        result: { auth: [], retval: StellarSdk.xdr.ScVal.scvVoid() },
      });

      // Unknown sendTransaction status
      jest.spyOn(rpc.Server.prototype, "sendTransaction").mockResolvedValueOnce({
        status: "MYSTERY_STATUS",
        hash: validHash,
        latestLedger: 100,
      } as unknown as StellarSdk.rpc.Api.SendTransactionResponse);

      await expect(
        soroban.invoke({
          contractId: CONTRACT_ID,
          method: "record_spend",
          args: [],
          sourceSecretKey: keypair.secret(),
        })
      ).rejects.toBeInstanceOf(UpstreamValidationError);

      // SUCCESS getTransaction missing ledger number
      jest.spyOn(rpc.Server.prototype, "sendTransaction").mockResolvedValueOnce({
        status: "PENDING",
        hash: validHash,
        latestLedger: 100,
        latestLedgerCloseTime: 0,
      });
      jest.spyOn(rpc.Server.prototype, "getTransaction").mockResolvedValueOnce({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
        latestLedger: 101,
      } as unknown as StellarSdk.rpc.Api.GetTransactionResponse);

      await expect(
        soroban.invoke({
          contractId: CONTRACT_ID,
          method: "record_spend",
          args: [],
          sourceSecretKey: keypair.secret(),
        })
      ).rejects.toBeInstanceOf(UpstreamValidationError);

      // Non-positive getLatestLedger sequence
      jest.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValueOnce({
        id: "ledger-0",
        protocolVersion: 21,
        sequence: 0,
      });
      await expect(soroban.getLatestLedger()).rejects.toBeInstanceOf(UpstreamValidationError);
    });
  });

  describe("Response size limits & HTTP client guards", () => {
    it("enforces maxResponseBytes on Horizon and Soroban RPC payloads", async () => {
      const tightHorizon = new StellarService(undefined, null, { maxResponseBytes: 512 });
      const pub = StellarSdk.Keypair.random().publicKey();

      jest.spyOn(Horizon.Server.prototype, "loadAccount").mockResolvedValueOnce(
        validHorizonAccount(pub, {
          data_attr: { oversized: "x".repeat(1024) },
        })
      );

      await expect(tightHorizon.getAccount(pub)).rejects.toBeInstanceOf(
        UpstreamResponseTooLargeError
      );

      const tightSoroban = new SorobanService({ maxResponseBytes: 256 });
      jest.spyOn(rpc.Server.prototype, "getLatestLedger").mockResolvedValueOnce({
        sequence: 123,
        id: "z".repeat(512),
      } as unknown as StellarSdk.rpc.Api.GetLatestLedgerResponse);

      await expect(tightSoroban.getLatestLedger()).rejects.toMatchObject({
        code: "SOROBAN_ERROR",
        status: 502,
        retryable: false,
        details: {
          upstream: "soroban_rpc",
          operation: "getLatestLedger",
          reason: "RESPONSE_TOO_LARGE",
          maxBytes: 256,
        },
      });
    });

    it("configures Axios defaults and response interceptors via installUpstreamHttpGuards", () => {
      let fulfilledHandler:
        | ((res: {
            data?: unknown;
            headers?: Record<string, unknown>;
            config?: { url?: string };
          }) => unknown)
        | undefined;
      let rejectedHandler: ((err: unknown) => unknown) | undefined;

      const fakeHttpClient = {
        defaults: {} as { maxContentLength?: number; maxBodyLength?: number },
        interceptors: {
          response: {
            use: (onFulfilled: typeof fulfilledHandler, onRejected: typeof rejectedHandler) => {
              fulfilledHandler = onFulfilled;
              rejectedHandler = onRejected;
            },
          },
        },
      };

      installUpstreamHttpGuards("horizon", fakeHttpClient, 1024);

      expect(fakeHttpClient.defaults.maxContentLength).toBe(1024);
      expect(fakeHttpClient.defaults.maxBodyLength).toBe(1024);
      expect(fulfilledHandler).toBeDefined();
      expect(rejectedHandler).toBeDefined();

      // Rejects oversized Content-Length header
      expect(() =>
        fulfilledHandler!({
          data: {},
          headers: { "content-length": "4096" },
          config: { url: "/accounts/GABC" },
        })
      ).toThrow(UpstreamResponseTooLargeError);

      // Translates Axios maxContentLength framing error into UpstreamResponseTooLargeError
      const axiosLengthErr = Object.assign(
        new Error("maxContentLength size of 1024 exceeded"),
        { config: { url: "/transactions" } }
      );
      expect(() => rejectedHandler!(axiosLengthErr)).toThrow(UpstreamResponseTooLargeError);
    });
  });

  describe("Shared error envelope integration on Express routes", () => {
    it("surfaces malformed and oversized Horizon responses as 502 HORIZON_ERROR without stack traces", async () => {
      const pub = StellarSdk.Keypair.random().publicKey();
      const app = createApp(new StellarService(undefined, null, { maxResponseBytes: 512 }));

      // 1. Malformed balance response -> 502 HORIZON_ERROR
      jest.spyOn(Horizon.Server.prototype, "loadAccount").mockResolvedValueOnce(
        validHorizonAccount(pub, {
          balances: [{ asset_type: "native", balance: "corrupt-amount" }],
        })
      );

      const malformedRes = await request(app)
        .get(`/api/v1/account/${pub}/balances`)
        .expect(502);

      expect(malformedRes.body).toMatchObject({
        error: {
          code: "HORIZON_ERROR",
          retryable: false,
          details: {
            upstream: "horizon",
            reason: "SCHEMA_VALIDATION_FAILED",
          },
        },
      });
      expect(malformedRes.body.error.stack).toBeUndefined();

      // 2. Oversized Horizon payload -> 502 HORIZON_ERROR
      jest.spyOn(Horizon.Server.prototype, "loadAccount").mockResolvedValueOnce(
        validHorizonAccount(pub, {
          balances: [{ asset_type: "native", balance: "10.0000000" }],
          extra_blob: "x".repeat(1024),
        })
      );

      const oversizedRes = await request(app)
        .get(`/api/v1/account/${pub}/balances`)
        .expect(502);

      expect(oversizedRes.body).toMatchObject({
        error: {
          code: "HORIZON_ERROR",
          retryable: false,
          details: {
            upstream: "horizon",
            reason: "RESPONSE_TOO_LARGE",
            maxBytes: 512,
          },
        },
      });
    });
  });
});
