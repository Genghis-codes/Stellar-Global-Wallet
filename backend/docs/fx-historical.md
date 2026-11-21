# Time-Correct FX Conversions for Historical Values

## Overview

Starting with the **FX Snapshot** feature, transaction values are converted using the FX rate that was in effect **at the time of the transaction**, not the current rate. This is essential for:

- **Tax reporting** - Values at the time of the transaction are required by tax authorities
- **Historical analysis** - Accurate portfolio tracking over time
- **Auditable records** - Financial statements that don't change daily

## How It Works

1. **Daily FX snapshots** are stored in the database (`fx_rate_snapshots` table)
2. When exporting transactions, the system looks up the FX rate for each transaction's date
3. If no snapshot exists for a specific date, the system falls back to the most recent available snapshot
4. For transactions within the last ~7 days, current live rates may be used

## Database Schema

The `fx_rate_snapshots` table contains:

| Column | Type | Description |
|--------|------|-------------|
| `date` | DATE | The date this snapshot represents |
| `base_currency` | VARCHAR(3) | Always "USD" |
| `quote_currency` | VARCHAR(3) | The target currency (EUR, GBP, NGN, etc.) |
| `rate` | DECIMAL(20,10) | Units of quote per 1 USD |
| `source` | VARCHAR(255) | Where the rate came from |
| `created_at` | TIMESTAMPTZ | When the snapshot was created |

## Backfilling Historical Data

To populate historical FX snapshots, use the backfill script:

```bash
# Backfill 30 days of data (default)
npm run backfill:fx

# Backfill a specific range
npm run backfill:fx 365 2025-01-01
```

This will:
- Fetch FX rates from the configured API (default: open.er-api.com)
- Store one snapshot per currency per day
- Skip dates that already have snapshots

## Configuration

Add to `.env`:

```env
FX_SNAPSHOT_CURRENCIES=EUR,GBP,NGN,KES,GHS
```

The list must contain only currencies from `SUPPORTED_CURRENCIES` in `src/services/fx.ts`.

## API Response Changes

### Transaction CSV Export

The CSV now includes three new columns:

| Column | Description |
|--------|-------------|
| `fx_rate` | The rate used for conversion |
| `fx_source` | The data source for the rate |
| `fx_snapshot_date` | The date the rate was taken from (empty for current rates) |

### Rate Metadata

When requesting FX quotes via the API, the response includes:

| Field | Description |
|-------|-------------|
| `snapshotDate` | ISO date string or `null` for current rates |

## Migration Required

After updating, run the migration:

```bash
npm run migrate
```

This creates the `fx_rate_snapshots` table and indexes.

## Performance

- Daily snapshots: ~5-10MB/year (depending on currency count)
- Query performance: Indexed lookups on `(date, base_currency, quote_currency)`
- Fallback behavior: Single index scan to find closest available snapshot

## Troubleshooting

### No FX rate found

If a transaction date has no snapshot:
- Run the backfill script to populate historical data
- Check `fx_rate_snapshots` table for gaps
- The system will use the most recent available snapshot as a fallback

### Rate seems incorrect

FX rates can vary between providers. The system records:
- Which provider was used (`source`)
- When the snapshot was taken (`snapshotDate`)

This allows auditing the exact rate used for each conversion.
