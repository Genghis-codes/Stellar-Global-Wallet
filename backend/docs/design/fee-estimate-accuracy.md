# Design note: Fee estimate accuracy tracking (#287)

## Goal

Measure how close our fee estimates are to the fees actually charged, for both
classic Stellar transactions (`fee_charged`) and Soroban resource fees, so we can
detect over-estimates (wasted user funds) and under-estimates (failed
transactions), alert on them, and tune margins automatically.

## Data model

A single in-process metrics registry (`backend/src/services/feeAccuracy.ts`)
records one sample per submission:

| field            | meaning                                                        |
| ---------------- | -------------------------------------------------------------- |
| `kind`           | `classic` or `soroban`                                         |
| `estimated`      | fee we quoted / used to build the tx (stroops, string)         |
| `actual`         | `fee_charged` (classic) or resource fee (Soroban), stroops     |
| `error`          | `actual - estimated` (negative = over-estimate)                |
| `ratio`          | `actual / estimated` (1.0 = perfect)                           |
| `band`           | `under`, `ok`, `over` relative to the configured tolerance     |

Amounts are kept as strings at the edge and converted to `BigInt` internally so
we never lose precision on large stroop values.

## Error bands

A sample is `ok` when `|ratio - 1| <= tolerance` (default 10%). Below that it is
`over` (we charged the user more than needed); above it is `under` (risk of
`txINSUFFICIENT_FEE`). Counts per band are exposed for dashboards and a
threshold on the `under` rate drives alerts.

## Automatic margin tuning

`recommendedMargin()` derives a multiplier from the observed `under` rate: if
under-estimates exceed the target rate the margin is nudged up, if we are
consistently over-estimating it is nudged down, clamped to a safe range. This is
advisory output consumed by the fee builders; it never mutates global state
implicitly, so callers stay deterministic and testable.

## Failure modes

- **Missing actual fee**: if a submission never confirms we simply do not record
a sample; the estimate is not counted as accurate.
- **Zero estimate**: guarded to avoid division by zero; such samples are skipped.
- **Clock/ordering**: samples are append-only and bounded (ring buffer) so memory
is capped under load.
- **Concurrency**: recording is synchronous and lock-free per Node's event loop;
aggregates are recomputed on read.

## Threat model

Metrics are internal only and never expose user keys or addresses. No new
privileged paths are introduced; the registry is read-only to callers outside the
fee services.

## Out of scope

UI dashboards/screens (built separately from design). This note covers the
backend measurement surface and the tuning hook only.
