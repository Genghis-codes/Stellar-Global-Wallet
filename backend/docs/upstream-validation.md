# Upstream Horizon and Soroban RPC Response Validation

`StellarService` (`src/services/stellar.ts`) and `SorobanService` (`src/services/soroban.ts`) treat every response from Horizon REST and Soroban JSON-RPC as untrusted external input.

## Threat model

- **Schema drift or buggy upstream nodes:** Third-party RPC/Horizon providers, self-hosted nodes across protocol upgrades, or misconfigured proxies can omit fields, return numbers instead of fixed-point decimal strings, or emit unexpected status enums. Without runtime validation, TypeScript `as` casts allow invalid values (`undefined`, `NaN`, non-boolean `successful`, missing SEP-29 `data_attr`) to reach fee, reserve, sequence, or memo logic.
- **Oversized responses (memory exhaustion):** A faulty or malicious upstream endpoint can return multi-megabyte JSON bodies or unbounded record arrays, exhausting V8 heap memory during deserialization or pagination.
- **Fallback catch masking:** Several helper paths (`destinationRequiresMemo`, `currentBaseFee`, `SorobanService.simulate`, `prepareInvocation`, `submitSigned`, `buildUnsignedTransaction`) intentionally catch network/404 errors. Upstream schema or size violations must never be swallowed by those fallbacks (for example, treating a corrupt destination account payload as "no SEP-29 memo required").

## Defence-in-depth enforcement

1. **HTTP client byte caps (`installUpstreamHttpGuards`):**
   - Sets `maxContentLength` and `maxBodyLength` on both `Horizon.Server#httpClient` and `rpc.Server#httpClient` (`HORIZON_MAX_RESPONSE_BYTES` and `SOROBAN_RPC_MAX_RESPONSE_BYTES`, both defaulting to `2097152` bytes / 2 MiB).
   - Installs a response interceptor that checks `Content-Length` headers, estimates decoded payload size, and maps Axios framing/length rejections to `UpstreamResponseTooLargeError`.
2. **Service-boundary byte & page caps (`assertWithinSizeLimit`):**
   - Uses a bounded structural walker (`estimatePayloadBytes`) that aborts as soon as `maxBytes` is exceeded, plus a hard cap of `200` records per paginated response (`MAX_UPSTREAM_PAGE_RECORDS`).
3. **Runtime `zod` schemas (`src/services/upstreamValidation.ts`):**
   - Validates all consumed fields on Horizon accounts (checksummed `G...` `accountId()`, integer `sequenceNumber()`, fixed-point decimal balance/liability strings, non-negative integer `subentry_count` and sponsorship counters, `0..255` `thresholds` and `signers`, string `data_attr`), transaction submissions, base fees, paged `/transactions`, `/payments`, `/operations`, joined parent transactions, and `/paths` quotes.
   - Validates all consumed fields on Soroban RPC `getAccount`, `simulateTransaction` (error vs. success shapes, `minResourceFee`, `SorobanDataBuilder`, `ScVal` return values, and XDR auth entries), `sendTransaction` status/hash/error XDR, `getTransaction` (`SUCCESS` requires positive integer `ledger`), and `getLatestLedger`.
   - Preserves underlying Stellar SDK class instances (`StellarSdk.Account`, `OperationRecord`, `SorobanDataBuilder`, `xdr.ScVal`) after validation so SDK methods (`incrementSequenceNumber()`, `op.transaction()`, `assembleTransaction()`) continue to operate without unsafe casts.

## Failure modes and error contract

All validation and size failures **fail closed** with HTTP `502 Bad Gateway`, `retryable: false`, and the shared error envelope:

| Failure | Error class | `error.code` | `error.details.reason` |
| --- | --- | --- | --- |
| Horizon schema mismatch | `UpstreamValidationError` | `HORIZON_ERROR` | `SCHEMA_VALIDATION_FAILED` |
| Soroban RPC schema mismatch | `UpstreamValidationError` | `SOROBAN_ERROR` | `SCHEMA_VALIDATION_FAILED` |
| Horizon payload exceeds `HORIZON_MAX_RESPONSE_BYTES` | `UpstreamResponseTooLargeError` | `HORIZON_ERROR` | `RESPONSE_TOO_LARGE` |
| Soroban RPC payload exceeds `SOROBAN_RPC_MAX_RESPONSE_BYTES` | `UpstreamResponseTooLargeError` | `SOROBAN_ERROR` | `RESPONSE_TOO_LARGE` |

Fallback `catch` blocks explicitly rethrow `isUpstreamValidationFailure(err)` so corrupt upstream payloads never silently degrade security checks.
