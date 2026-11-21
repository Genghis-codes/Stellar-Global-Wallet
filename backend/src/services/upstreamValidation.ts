import * as StellarSdk from "@stellar/stellar-sdk";
import { z } from "zod";
import { AppError } from "../errors/appError";
import { HORIZON_MAX_PAGE_SIZE } from "./transactionHistory";
import { isGAddress } from "../utils/stellarAddress";

export type UpstreamSource = "horizon" | "soroban_rpc";

export interface UpstreamValidationIssue {
  path: string;
  message: string;
  code: string;
}

/**
 * Default upper bound (2 MiB) on individual Horizon REST or Soroban JSON-RPC
 * responses accepted before failing closed.
 */
export const DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Maximum number of records accepted in a single upstream paginated response. */
export const MAX_UPSTREAM_PAGE_RECORDS = HORIZON_MAX_PAGE_SIZE;

/**
 * Fail-closed error raised whenever an upstream Horizon or Soroban RPC
 * response violates the runtime schema expected by this backend.
 */
export class UpstreamValidationError extends AppError {
  readonly upstream: UpstreamSource;
  readonly operation: string;
  readonly issues: UpstreamValidationIssue[];

  constructor(
    upstream: UpstreamSource,
    operation: string,
    issues: UpstreamValidationIssue[],
    message?: string
  ) {
    const label = upstream === "horizon" ? "Horizon" : "Soroban RPC";
    super(
      message ?? `Invalid ${label} response for ${operation}: schema validation failed`,
      {
        code: upstream === "horizon" ? "HORIZON_ERROR" : "SOROBAN_ERROR",
        status: 502,
        retryable: false,
        details: {
          upstream,
          operation,
          reason: "SCHEMA_VALIDATION_FAILED",
          issues,
        },
      }
    );
    this.upstream = upstream;
    this.operation = operation;
    this.issues = issues;
  }
}

/**
 * Fail-closed error raised whenever an upstream Horizon or Soroban RPC
 * response exceeds the configured byte-size or page-record limit.
 */
export class UpstreamResponseTooLargeError extends AppError {
  readonly upstream: UpstreamSource;
  readonly operation: string;
  readonly maxBytes: number;
  readonly actualBytes?: number;

  constructor(
    upstream: UpstreamSource,
    operation: string,
    maxBytes: number,
    actualBytes?: number
  ) {
    const label = upstream === "horizon" ? "Horizon" : "Soroban RPC";
    super(
      `${label} response for ${operation} exceeded the maximum allowed size of ${maxBytes} bytes`,
      {
        code: upstream === "horizon" ? "HORIZON_ERROR" : "SOROBAN_ERROR",
        status: 502,
        retryable: false,
        details: {
          upstream,
          operation,
          reason: "RESPONSE_TOO_LARGE",
          maxBytes,
          ...(actualBytes !== undefined ? { actualBytes } : {}),
        },
      }
    );
    this.upstream = upstream;
    this.operation = operation;
    this.maxBytes = maxBytes;
    this.actualBytes = actualBytes;
  }
}

export function isUpstreamValidationFailure(
  err: unknown
): err is UpstreamValidationError | UpstreamResponseTooLargeError {
  return (
    err instanceof UpstreamValidationError ||
    err instanceof UpstreamResponseTooLargeError
  );
}

// ---------------------------------------------------------------------------
//  Transport & payload size enforcement
// ---------------------------------------------------------------------------

interface HttpClientLike {
  defaults?: {
    maxContentLength?: number;
    maxBodyLength?: number;
  };
  interceptors?: {
    response?: {
      use: (
        onFulfilled: (response: {
          data?: unknown;
          headers?: Record<string, unknown>;
          config?: { url?: string };
        }) => unknown,
        onRejected: (error: unknown) => unknown
      ) => unknown;
    };
  };
}

/**
 * Attaches transport-level response byte limits and an Axios response
 * interceptor to a Stellar SDK `Horizon.Server` or `rpc.Server` HTTP client.
 */
export function installUpstreamHttpGuards(
  upstream: UpstreamSource,
  httpClient: unknown,
  maxBytes: number
): void {
  if (!httpClient || typeof httpClient !== "object") return;
  const client = httpClient as HttpClientLike;

  if (client.defaults && typeof client.defaults === "object") {
    client.defaults.maxContentLength = maxBytes;
    client.defaults.maxBodyLength = maxBytes;
  }

  client.interceptors?.response?.use(
    (response) => {
      const operation =
        typeof response.config?.url === "string" && response.config.url.length > 0
          ? response.config.url
          : "httpResponse";

      const rawContentLength =
        response.headers?.["content-length"] ?? response.headers?.["Content-Length"];
      if (rawContentLength !== undefined) {
        const parsedLength = Number(rawContentLength);
        if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
          throw new UpstreamResponseTooLargeError(
            upstream,
            operation,
            maxBytes,
            parsedLength
          );
        }
      }

      const estimated = estimatePayloadBytes(response.data, maxBytes);
      if (estimated > maxBytes) {
        throw new UpstreamResponseTooLargeError(upstream, operation, maxBytes, estimated);
      }

      return response;
    },
    (error: unknown) => {
      if (isUpstreamValidationFailure(error)) {
        throw error;
      }
      if (error instanceof Error) {
        const errWithConfig = error as Error & {
          code?: string;
          config?: { url?: string };
        };
        if (
          /maxContentLength|maxBodyLength/i.test(error.message) ||
          errWithConfig.code === "ERR_FRAMING"
        ) {
          const operation = errWithConfig.config?.url ?? "httpResponse";
          throw new UpstreamResponseTooLargeError(upstream, operation, maxBytes);
        }
      }
      throw error;
    }
  );
}

/**
 * Bounded structural byte estimator for parsed SDK/JSON values. Stops walking
 * as soon as `maxBytes` is exceeded so oversized responses fail closed in
 * O(maxBytes) work without serializing multi-megabyte strings.
 */
export function estimatePayloadBytes(value: unknown, maxBytes: number): number {
  const seen = new WeakSet<object>();

  function walk(current: unknown, running: number): number {
    if (running > maxBytes) return running;
    if (current === null || current === undefined) return running + 4;

    const kind = typeof current;
    if (kind === "string") {
      return running + Buffer.byteLength(current as string, "utf8") + 2;
    }
    if (kind === "number" || kind === "boolean" || kind === "bigint") {
      return running + 8;
    }
    if (kind === "function" || kind === "symbol") {
      return running;
    }

    if (Buffer.isBuffer(current) || ArrayBuffer.isView(current)) {
      return running + current.byteLength;
    }

    const obj = current as object;
    if (seen.has(obj)) return running;
    seen.add(obj);

    if (Array.isArray(current)) {
      let total = running + 2;
      for (let i = 0; i < current.length; i++) {
        total = walk(current[i], total + 1);
        if (total > maxBytes) return total;
      }
      return total;
    }

    let total = running + 2;
    for (const [key, entry] of Object.entries(obj)) {
      if (typeof entry === "function") continue;
      total += Buffer.byteLength(key, "utf8") + 3;
      if (total > maxBytes) return total;
      total = walk(entry, total);
      if (total > maxBytes) return total;
    }
    return total;
  }

  return walk(value, 0);
}

export function assertWithinSizeLimit(
  upstream: UpstreamSource,
  operation: string,
  payload: unknown,
  maxBytes: number
): void {
  const bytes = estimatePayloadBytes(payload, maxBytes);
  if (bytes > maxBytes) {
    throw new UpstreamResponseTooLargeError(upstream, operation, maxBytes, bytes);
  }
}

function toUpstreamIssues(error: z.ZodError): UpstreamValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "<root>",
    message: issue.message,
    code: issue.code,
  }));
}

function parseWithSchema<T>(
  upstream: UpstreamSource,
  operation: string,
  schema: z.ZodType<T>,
  payload: unknown,
  maxBytes: number
): T {
  assertWithinSizeLimit(upstream, operation, payload, maxBytes);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new UpstreamValidationError(upstream, operation, toUpstreamIssues(parsed.error));
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
//  Shared primitive schemas
// ---------------------------------------------------------------------------

/** Fixed-point non-negative Stellar decimal string (up to 7 fractional digits). */
export const DecimalAmountStringSchema = z
  .string()
  .regex(/^\d+(?:\.\d{1,7})?$/, "must be a non-negative decimal string with up to 7 decimal places");

/** Non-negative integer string (sequence numbers, stroop fees). */
export const NonNegativeIntegerStringSchema = z
  .string()
  .regex(/^\d+$/, "must be a non-negative integer string");

/** Validated Stellar G... Ed25519 public key. */
export const GAddressStringSchema = z
  .string()
  .refine((val) => isGAddress(val), "must be a valid checksummed Stellar G... public key");

/** ISO-8601 timestamp string parseable by `Date.parse`. */
export const IsoTimestampStringSchema = z
  .string()
  .min(1)
  .refine((val) => !Number.isNaN(Date.parse(val)), "must be a valid ISO-8601 timestamp");

function isPlainOrSdkObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
//  Horizon schemas
// ---------------------------------------------------------------------------

const NativeBalanceLineSchema = z
  .object({
    asset_type: z.literal("native"),
    balance: DecimalAmountStringSchema,
    selling_liabilities: DecimalAmountStringSchema.optional(),
    buying_liabilities: DecimalAmountStringSchema.optional(),
  })
  .passthrough();

const CreditBalanceLineSchema = z
  .object({
    asset_type: z.enum(["credit_alphanum4", "credit_alphanum12"]),
    asset_code: z.string().regex(/^[A-Za-z0-9]{1,12}$/, "must be a 1-12 char asset code"),
    asset_issuer: GAddressStringSchema,
    balance: DecimalAmountStringSchema,
    limit: DecimalAmountStringSchema.optional(),
    selling_liabilities: DecimalAmountStringSchema.optional(),
    buying_liabilities: DecimalAmountStringSchema.optional(),
    sponsor: GAddressStringSchema.optional(),
    is_authorized: z.boolean().optional(),
  })
  .passthrough();

const LiquidityPoolBalanceLineSchema = z
  .object({
    asset_type: z.literal("liquidity_pool_shares"),
    balance: DecimalAmountStringSchema,
    liquidity_pool_id: z.string().min(1).optional(),
    selling_liabilities: DecimalAmountStringSchema.optional(),
  })
  .passthrough();

export const HorizonBalanceLineSchema = z.discriminatedUnion("asset_type", [
  NativeBalanceLineSchema,
  CreditBalanceLineSchema,
  LiquidityPoolBalanceLineSchema,
]);

export type ValidatedHorizonBalanceLine = z.infer<typeof HorizonBalanceLineSchema>;

export const HorizonThresholdsSchema = z
  .object({
    low_threshold: z.number().int().min(0).max(255),
    med_threshold: z.number().int().min(0).max(255),
    high_threshold: z.number().int().min(0).max(255),
  })
  .passthrough();

export const HorizonSignerSchema = z
  .object({
    key: z.string().min(1),
    weight: z.number().int().min(0).max(255),
    type: z.string().min(1).optional(),
  })
  .passthrough();

const HorizonAccountOptionalFieldsSchema = z
  .object({
    account_id: GAddressStringSchema.optional(),
    balances: z.array(HorizonBalanceLineSchema).optional(),
    subentry_count: z.number().int().nonnegative().optional(),
    num_sponsoring: z.number().int().nonnegative().optional(),
    num_sponsored: z.number().int().nonnegative().optional(),
    thresholds: HorizonThresholdsSchema.optional(),
    signers: z.array(HorizonSignerSchema).optional(),
    data_attr: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

export const HorizonAccountSchema = z.custom<StellarSdk.Horizon.AccountResponse>().superRefine(
  (raw, ctx) => {
    if (!isPlainOrSdkObject(raw)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Horizon account response must be an object",
      });
      return;
    }

    const candidate = raw as Record<string, unknown>;
    const hasSdkMethods =
      typeof candidate.accountId === "function" &&
      typeof candidate.sequenceNumber === "function" &&
      typeof candidate.incrementSequenceNumber === "function";

    let accountId: unknown;
    let sequenceNumber: unknown;

    if (hasSdkMethods) {
      try {
        accountId = (candidate.accountId as () => unknown)();
        sequenceNumber = (candidate.sequenceNumber as () => unknown)();
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Failed to read accountId/sequenceNumber: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
    } else if (
      (candidate.account_id !== undefined || candidate._accountId !== undefined) &&
      candidate.sequence !== undefined
    ) {
      accountId = candidate.account_id ?? candidate._accountId;
      const rawSeq = candidate.sequence;
      sequenceNumber =
        typeof rawSeq === "object" &&
        rawSeq !== null &&
        typeof (rawSeq as { toFixed?: unknown }).toFixed === "function"
          ? (rawSeq as { toFixed: () => string }).toFixed()
          : rawSeq;
    } else {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Horizon account response must expose accountId()/sequenceNumber()/incrementSequenceNumber() or valid account_id + sequence fields",
      });
      return;
    }

    const idCheck = GAddressStringSchema.safeParse(accountId);
    if (!idCheck.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accountId"],
        message: "accountId() must return a valid checksummed Stellar G... address",
      });
    }

    const seqCheck = NonNegativeIntegerStringSchema.safeParse(sequenceNumber);
    if (!seqCheck.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sequence"],
        message: "sequenceNumber() must return a non-negative integer string",
      });
    }

    const fieldsCheck = HorizonAccountOptionalFieldsSchema.safeParse(candidate);
    if (!fieldsCheck.success) {
      for (const issue of fieldsCheck.error.issues) {
        ctx.addIssue(issue);
      }
      return;
    }

    if (
      fieldsCheck.data.account_id !== undefined &&
      idCheck.success &&
      fieldsCheck.data.account_id !== idCheck.data
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["account_id"],
        message: "account_id does not match accountId()",
      });
    }
  }
);

const HorizonAccountBalancesRequiredSchema = z
  .object({
    balances: z.array(HorizonBalanceLineSchema),
  })
  .passthrough();

const HorizonAccountReservesRequiredSchema = z
  .object({
    balances: z.array(HorizonBalanceLineSchema),
    subentry_count: z.number().int().nonnegative(),
    num_sponsoring: z.number().int().nonnegative().optional(),
    num_sponsored: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const HorizonAccountThresholdsRequiredSchema = z
  .object({
    thresholds: HorizonThresholdsSchema,
    signers: z.array(HorizonSignerSchema).optional(),
  })
  .passthrough();

export const HorizonSubmitTransactionSchema = z
  .object({
    hash: z.string().min(1).max(128),
    successful: z.boolean(),
    ledger: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const HorizonBaseFeeSchema = z
  .union([
    z.number().int().positive(),
    z
      .string()
      .regex(/^[1-9]\d*$/, "must be a positive integer string")
      .transform((val) => Number(val)),
  ])
  .pipe(z.number().int().positive().max(1_000_000_000));

export const HorizonTransactionSummaryRecordSchema = z
  .object({
    id: z.string().min(1),
    paging_token: z.string().min(1),
    hash: z.string().min(1),
    ledger_attr: z.number().int().nonnegative(),
    created_at: IsoTimestampStringSchema,
    operation_count: z.number().int().nonnegative(),
    memo: z.string().optional(),
  })
  .passthrough();

export const HorizonTransactionsPageSchema = z
  .object({
    records: z.array(HorizonTransactionSummaryRecordSchema).max(MAX_UPSTREAM_PAGE_RECORDS),
  })
  .passthrough();

const StroopsFeeValueSchema = z.union([
  NonNegativeIntegerStringSchema,
  z.number().int().nonnegative(),
]);

export const HorizonTransactionDetailSchema = z
  .object({
    id: z.string().min(1).optional(),
    hash: z.string().min(1),
    ledger_attr: z.number().int().nonnegative(),
    created_at: IsoTimestampStringSchema,
    successful: z.boolean(),
    source_account: z.string().min(1),
    fee_account: z.string().min(1),
    fee_charged: StroopsFeeValueSchema,
    max_fee: StroopsFeeValueSchema,
    memo: z.string().optional(),
    memo_type: z.string().min(1),
    operation_count: z.number().int().nonnegative(),
  })
  .passthrough();

export const HorizonJoinedTransactionSchema = z
  .object({
    id: z.string().min(1).optional(),
    hash: z.string().min(1).optional(),
    fee_charged: StroopsFeeValueSchema.optional(),
    fee_account: z.string().min(1).optional(),
    source_account: z.string().min(1).optional(),
    memo: z.string().optional(),
    memo_type: z.string().min(1).optional(),
    operation_count: z.number().int().nonnegative().optional(),
    successful: z.boolean().optional(),
  })
  .passthrough();

const OperationAssetFields = {
  amount: DecimalAmountStringSchema.optional(),
  source_amount: DecimalAmountStringSchema.optional(),
  starting_balance: DecimalAmountStringSchema.optional(),
  limit: DecimalAmountStringSchema.optional(),
  asset_type: z
    .enum(["native", "credit_alphanum4", "credit_alphanum12", "liquidity_pool_shares"])
    .optional(),
  asset_code: z.string().min(1).max(12).optional(),
  asset_issuer: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
};

export const HorizonPaymentOperationRecordSchema = z
  .object({
    id: z.string().min(1),
    paging_token: z.string().min(1),
    type: z.string().min(1),
    transaction_hash: z.string().min(1),
    created_at: IsoTimestampStringSchema,
    source_account: z.string().min(1).optional(),
    transaction_successful: z.boolean().optional(),
    ...OperationAssetFields,
  })
  .passthrough();

export const HorizonHistoryOperationRecordSchema = z
  .object({
    id: z.string().min(1),
    paging_token: z.string().min(1),
    type: z.string().min(1),
    source_account: z.string().min(1),
    transaction_hash: z.string().min(1),
    created_at: IsoTimestampStringSchema,
    transaction_successful: z.boolean().optional(),
    ...OperationAssetFields,
  })
  .passthrough();

const HorizonPathAssetHopSchema = z
  .object({
    asset_type: z.enum(["native", "credit_alphanum4", "credit_alphanum12"]),
    asset_code: z.string().min(1).max(12).optional(),
    asset_issuer: GAddressStringSchema.optional(),
  })
  .passthrough()
  .superRefine((hop, ctx) => {
    if (hop.asset_type !== "native") {
      if (!hop.asset_code) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["asset_code"],
          message: "non-native path asset must include asset_code",
        });
      }
      if (!hop.asset_issuer) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["asset_issuer"],
          message: "non-native path asset must include asset_issuer",
        });
      }
    }
  });

export const HorizonPathRecordSchema = z
  .object({
    source_asset_type: z.enum(["native", "credit_alphanum4", "credit_alphanum12"]),
    source_asset_code: z.string().min(1).max(12).optional(),
    source_asset_issuer: GAddressStringSchema.optional(),
    source_amount: DecimalAmountStringSchema,
    destination_asset_type: z.enum(["native", "credit_alphanum4", "credit_alphanum12"]),
    destination_asset_code: z.string().min(1).max(12).optional(),
    destination_asset_issuer: GAddressStringSchema.optional(),
    destination_amount: DecimalAmountStringSchema,
    path: z.array(HorizonPathAssetHopSchema),
  })
  .passthrough();

export const HorizonPathsPageSchema = z
  .object({
    records: z.array(HorizonPathRecordSchema).max(MAX_UPSTREAM_PAGE_RECORDS),
  })
  .passthrough();

// ---------------------------------------------------------------------------
//  Horizon validation entry points
// ---------------------------------------------------------------------------

export function validateHorizonAccount(
  raw: unknown,
  maxBytes = DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES
): StellarSdk.Horizon.AccountResponse {
  return parseWithSchema("horizon", "loadAccount", HorizonAccountSchema, raw, maxBytes);
}

export function validateHorizonAccountBalances(
  raw: unknown,
  maxBytes = DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES
): ValidatedHorizonBalanceLine[] {
  const parsed = parseWithSchema(
    "horizon",
    "loadAccount.balances",
    HorizonAccountBalancesRequiredSchema,
    raw,
    maxBytes
  );
  return parsed.balances;
}

export function validateHorizonAccountReserves(
  raw: unknown,
  maxBytes = DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES
): z.infer<typeof HorizonAccountReservesRequiredSchema> {
  return parseWithSchema(
    "horizon",
    "loadAccount.reserves",
    HorizonAccountReservesRequiredSchema,
    raw,
    maxBytes
  );
}

export function validateHorizonAccountThresholds(
  raw: unknown,
  maxBytes = DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES
): z.infer<typeof HorizonAccountThresholdsRequiredSchema> {
  return parseWithSchema(
    "horizon",
    "loadAccount.thresholds",
    HorizonAccountThresholdsRequiredSchema,
    raw,
    maxBytes
  );
}

export function validateHorizonSubmitResponse(
  raw: unknown,
  maxBytes = DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES
): StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse {
  parseWithSchema("horizon", "submitTransaction", HorizonSubmitTransactionSchema, raw, maxBytes);
  return raw as StellarSdk.Horizon.HorizonApi.SubmitTransactionResponse;
}

export function validateHorizonBaseFee(
  raw: unknown,
  maxBytes = DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES
): number {
  return parseWithSchema("horizon", "fetchBaseFee", HorizonBaseFeeSchema, raw, maxBytes);
}

export function validateHorizonTransactionsPage(
  raw: unknown,
  maxBytes = DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES
): z.infer<typeof HorizonTransactionsPageSchema> {
  return parseWithSchema(
    "horizon",
    "transactions",
    HorizonTransactionsPageSchema,
    raw,
    maxBytes
  );
}

export const HorizonTransactionLookupSchema = z
  .object({
    id: z.string().min(1).optional(),
    hash: z.string().min(1).optional(),
    successful: z.boolean().optional(),
  })
  .passthrough();

export function validateHorizonTransactionLookup(
  raw: unknown,
  maxBytes = DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES
): void {
  parseWithSchema(
    "horizon",
    "transactions.transaction",
    HorizonTransactionLookupSchema,
    raw,
    maxBytes
  );
}

export function validateHorizonTransactionDetail(
  raw: unknown,
  maxBytes = DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES
): StellarSdk.Horizon.ServerApi.TransactionRecord {
  parseWithSchema(
    "horizon",
    "transactions.transaction",
    HorizonTransactionDetailSchema,
    raw,
    maxBytes
  );
  return raw as StellarSdk.Horizon.ServerApi.TransactionRecord;
}

export function validateHorizonJoinedTransaction(
  raw: unknown,
  maxBytes = DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES
): StellarSdk.Horizon.ServerApi.TransactionRecord {
  parseWithSchema(
    "horizon",
    "operation.transaction",
    HorizonJoinedTransactionSchema,
    raw,
    maxBytes
  );
  return raw as StellarSdk.Horizon.ServerApi.TransactionRecord;
}

function validateOperationCollection(
  operationName: string,
  itemSchema: z.ZodTypeAny,
  raw: unknown,
  maxBytes: number
): StellarSdk.Horizon.ServerApi.OperationRecord[] {
  assertWithinSizeLimit("horizon", operationName, raw, maxBytes);
  if (!isPlainOrSdkObject(raw) || !Array.isArray(raw.records)) {
    throw new UpstreamValidationError("horizon", operationName, [
      {
        path: "records",
        message: "Horizon page response must contain a records array",
        code: "invalid_type",
      },
    ]);
  }
  if (raw.records.length > MAX_UPSTREAM_PAGE_RECORDS) {
    throw new UpstreamValidationError("horizon", operationName, [
      {
        path: "records",
        message: `Horizon page exceeded maximum of ${MAX_UPSTREAM_PAGE_RECORDS} records`,
        code: "too_big",
      },
    ]);
  }

  for (let i = 0; i < raw.records.length; i++) {
    const check = itemSchema.safeParse(raw.records[i]);
    if (!check.success) {
      const issues = check.error.issues.map((issue) => ({
        path: ["records", String(i), ...issue.path.map(String)].join("."),
        message: issue.message,
        code: issue.code,
      }));
      throw new UpstreamValidationError("horizon", operationName, issues);
    }
  }

  return raw.records as StellarSdk.Horizon.ServerApi.OperationRecord[];
}

export function validateHorizonPaymentsPage(
  raw: unknown,
  maxBytes = DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES
): StellarSdk.Horizon.ServerApi.OperationRecord[] {
  return validateOperationCollection(
    "payments",
    HorizonPaymentOperationRecordSchema,
    raw,
    maxBytes
  );
}

export function validateHorizonOperationsPage(
  raw: unknown,
  maxBytes = DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES
): StellarSdk.Horizon.ServerApi.OperationRecord[] {
  return validateOperationCollection(
    "operations",
    HorizonHistoryOperationRecordSchema,
    raw,
    maxBytes
  );
}

export function validateHorizonPathsPage(
  raw: unknown,
  operation: "strictSendPaths" | "strictReceivePaths",
  maxBytes = DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES
): z.infer<typeof HorizonPathRecordSchema>[] {
  const parsed = parseWithSchema("horizon", operation, HorizonPathsPageSchema, raw, maxBytes);
  return parsed.records;
}

// ---------------------------------------------------------------------------
//  Soroban RPC schemas & validation entry points
// ---------------------------------------------------------------------------

const XdrSerializableSchema = z.custom<{ toXDR(format?: string): string | Buffer }>(
  (val) => isPlainOrSdkObject(val) && typeof val.toXDR === "function",
  { message: "must be an XDR-serializable object with toXDR()" }
);

const ScValInstanceSchema = z.custom<StellarSdk.xdr.ScVal>(
  (val) =>
    val instanceof StellarSdk.xdr.ScVal ||
    (isPlainOrSdkObject(val) &&
      typeof val.toXDR === "function" &&
      typeof val.switch === "function"),
  { message: "must be a valid StellarSdk.xdr.ScVal instance" }
);

const SorobanDataBuilderLikeSchema = z.custom<StellarSdk.SorobanDataBuilder>(
  (val) => isPlainOrSdkObject(val) && typeof val.build === "function",
  { message: "must be a SorobanDataBuilder instance with build()" }
);

const TransactionResultXdrLikeSchema = z.custom<StellarSdk.xdr.TransactionResult>(
  (val) =>
    isPlainOrSdkObject(val) &&
    typeof val.toXDR === "function" &&
    typeof val.result === "function",
  { message: "must be a valid xdr.TransactionResult instance" }
);

export const RpcAccountSchema = z.custom<StellarSdk.Account>().superRefine((raw, ctx) => {
  if (!isPlainOrSdkObject(raw)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Soroban RPC getAccount response must be an Account object",
    });
    return;
  }

  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.accountId !== "function" ||
    typeof candidate.sequenceNumber !== "function" ||
    typeof candidate.incrementSequenceNumber !== "function"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Soroban RPC Account must expose accountId(), sequenceNumber(), and incrementSequenceNumber()",
    });
    return;
  }

  const accountId = (candidate.accountId as () => unknown)();
  const sequenceNumber = (candidate.sequenceNumber as () => unknown)();

  if (!GAddressStringSchema.safeParse(accountId).success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["accountId"],
      message: "accountId() must return a valid checksummed Stellar G... address",
    });
  }
  if (!NonNegativeIntegerStringSchema.safeParse(sequenceNumber).success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sequence"],
      message: "sequenceNumber() must return a non-negative integer string",
    });
  }
});

const RpcSimulateErrorSchema = z
  .object({
    id: z.string().min(1).optional(),
    latestLedger: z.number().int().nonnegative(),
    error: z.string().min(1),
    events: z.array(z.unknown()).optional(),
  })
  .passthrough();

const RpcSimulateSuccessSchema = z
  .object({
    id: z.string().min(1).optional(),
    latestLedger: z.number().int().nonnegative(),
    minResourceFee: NonNegativeIntegerStringSchema,
    transactionData: SorobanDataBuilderLikeSchema,
    events: z.array(z.unknown()).optional(),
    result: z
      .object({
        auth: z.array(XdrSerializableSchema),
        retval: ScValInstanceSchema,
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const RpcSimulateTransactionSchema = z
  .custom<StellarSdk.rpc.Api.SimulateTransactionResponse>()
  .superRefine((raw, ctx) => {
    if (!isPlainOrSdkObject(raw)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Soroban simulateTransaction response must be an object",
      });
      return;
    }

    const hasError = "error" in raw && raw.error !== undefined;
    const result = hasError
      ? RpcSimulateErrorSchema.safeParse(raw)
      : RpcSimulateSuccessSchema.safeParse(raw);

    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue(issue);
      }
    }
  });

export const RpcSendTransactionSchema = z
  .object({
    status: z.enum(["PENDING", "DUPLICATE", "TRY_AGAIN_LATER", "ERROR"]),
    hash: z.string().regex(/^[0-9a-fA-F]{64}$/, "must be a 64-character hex transaction hash"),
    latestLedger: z.number().int().nonnegative(),
    latestLedgerCloseTime: z
      .union([z.number().int().nonnegative(), NonNegativeIntegerStringSchema])
      .optional(),
    errorResult: TransactionResultXdrLikeSchema.optional(),
  })
  .passthrough();

const RpcGetTransactionNotFoundSchema = z
  .object({
    status: z.literal("NOT_FOUND"),
    latestLedger: z.number().int().nonnegative(),
  })
  .passthrough();

const RpcGetTransactionSuccessSchema = z
  .object({
    status: z.literal("SUCCESS"),
    latestLedger: z.number().int().nonnegative(),
    ledger: z.number().int().positive(),
    returnValue: ScValInstanceSchema.optional(),
  })
  .passthrough();

const RpcGetTransactionFailedSchema = z
  .object({
    status: z.literal("FAILED"),
    latestLedger: z.number().int().nonnegative(),
    ledger: z.number().int().positive().optional(),
  })
  .passthrough();

export const RpcGetTransactionSchema = z.discriminatedUnion("status", [
  RpcGetTransactionNotFoundSchema,
  RpcGetTransactionSuccessSchema,
  RpcGetTransactionFailedSchema,
]);

export const RpcLatestLedgerSchema = z
  .object({
    sequence: z.number().int().positive(),
    id: z.string().min(1).optional(),
    protocolVersion: z.number().int().positive().optional(),
  })
  .passthrough();

export function validateSorobanAccount(
  raw: unknown,
  maxBytes = DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES
): StellarSdk.Account {
  return parseWithSchema("soroban_rpc", "getAccount", RpcAccountSchema, raw, maxBytes);
}

export function validateSorobanSimulation(
  raw: unknown,
  maxBytes = DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES
): StellarSdk.rpc.Api.SimulateTransactionResponse {
  return parseWithSchema(
    "soroban_rpc",
    "simulateTransaction",
    RpcSimulateTransactionSchema,
    raw,
    maxBytes
  );
}

export function validateSorobanSendTransaction(
  raw: unknown,
  maxBytes = DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES
): StellarSdk.rpc.Api.SendTransactionResponse {
  parseWithSchema(
    "soroban_rpc",
    "sendTransaction",
    RpcSendTransactionSchema,
    raw,
    maxBytes
  );
  return raw as StellarSdk.rpc.Api.SendTransactionResponse;
}

export function validateSorobanGetTransaction(
  raw: unknown,
  maxBytes = DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES
): StellarSdk.rpc.Api.GetTransactionResponse {
  parseWithSchema(
    "soroban_rpc",
    "getTransaction",
    RpcGetTransactionSchema,
    raw,
    maxBytes
  );
  return raw as StellarSdk.rpc.Api.GetTransactionResponse;
}

export function validateSorobanLatestLedger(
  raw: unknown,
  maxBytes = DEFAULT_UPSTREAM_MAX_RESPONSE_BYTES
): z.infer<typeof RpcLatestLedgerSchema> {
  return parseWithSchema(
    "soroban_rpc",
    "getLatestLedger",
    RpcLatestLedgerSchema,
    raw,
    maxBytes
  );
}
