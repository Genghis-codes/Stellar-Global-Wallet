# Activity feed and event indexing (#79)

Covers `GET /api/v1/account/:publicKey/activity`.

The activity feed combines Horizon payment history with indexed Soroban contract
events into a unified timeline. This enables clients to show all wallet activity
in a single sorted feed.

## Data sources

### Horizon payments

Payments are read from Horizon's `/accounts/:id/operations` with `join=transactions`.
These include all payment-like operations: `payment`, `path_payment_*`,
`create_account`, etc.

### Contract events

Contract events are indexed from Soroban RPC's `getEvents` into a PostgreSQL table.
This ensures:

1. **Durable storage** - events survive restarts and can be queried reliably
2. **Consistent pagination** - events are stored with their ledger position
3. **Retention gap handling** - gaps in event history are detected and reconciled

## Composite cursor

Pagination uses a composite cursor that encodes:
- `ledger` (64-bit): The ledger sequence number
- `txIndex` (32-bit): Transaction index within the ledger
- `opIndex` (32-bit): Operation index within the transaction
- `source` (string): Opaque cursor token from the last item

This encoding ensures stable ordering across multiple data sources.

## K-way merge

When fetching a page, the API:

1. Fetches Horizon payments with lookahead (2x limit)
2. Fetches contract events from the database with lookahead
3. Merges items by timestamp, using ID as tiebreaker
4. Returns the first `limit` items

This approach:
- Ensures no duplicates (each item has a unique ID across sources)
- Ensures no gaps (lookahead fetches more than needed)
- Maintains stable ordering (timestamp + ID)

## Horizon page caching

Horizon pages are cached for 60 seconds per account to reduce RPC load.
Cache keys are: `{account}|{pageSize}|{cursor}`

## Retention gap detection

The indexer tracks its position in `activity_feed_cursor`. If the cursor falls
behind RPC's ~7-day event retention window, it:

1. Detects the gap (> 17280 ledgers)
2. Logs a warning
3. Resets the cursor to start fresh

## Lag monitoring

The indexer logs lag metrics when more than 100 ledgers behind the current
ledger. This is logged but does not block processing.

## Database schema

### `activity_feed_events`

| Column | Type | Description |
|--------|------|-------------|
| id | BIGSERIAL | Primary key |
| event_id | VARCHAR(255) | Unique event ID from Soroban RPC |
| contract_id | VARCHAR(56) | Contract ID |
| ledger | BIGINT | Ledger sequence |
| ledger_closed_at | TIMESTAMPTZ | When the ledger closed |
| topic0 | TEXT | First topic (event name) |
| topic1 | TEXT | Second topic (event subtype) |
| value_json | JSONB | Event payload |
| tx_hash | TEXT | Transaction hash |
| created_at | TIMESTAMPTZ | When the event was stored |

### `activity_feed_cursor`

| Column | Type | Description |
|--------|------|-------------|
| id | BIGSERIAL | Primary key |
| contract_id | VARCHAR(56) | Contract ID (unique) |
| last_event_id | VARCHAR(255) | Last processed event ID |
| last_ledger | BIGINT | Last processed ledger |
| last_checked_at | TIMESTAMPTZ | Last check timestamp |

### `activity_feed_alerts`

| Column | Type | Description |
|--------|------|-------------|
| id | BIGSERIAL | Primary key |
| alert_type | VARCHAR(32) | Type of alert |
| contract_id | VARCHAR(56) | Contract ID (nullable) |
| message | TEXT | Alert message |
| details | JSONB | Additional details |
| created_at | TIMESTAMPTZ | When the alert was created |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `INDEXER_START_LEDGER` | 0 | Ledger to start indexing from |
| `INDEXER_POLL_INTERVAL_MS` | 5000 | Poll frequency in milliseconds |
| `INDEXER_PAGE_SIZE` | 200 | Max events per page |

## Metrics

Metrics are logged to stdout:
```
[activity-feed] metrics for C...: last_ledger=1000, current=1050, gap=50, duration=250ms
```

Lag alerts are logged when the indexer is more than 100 ledgers behind:
```
[activity-feed] lag alert for C...: 150 ledgers behind
```

## Testing

The activity feed is tested in the integration test suite. Test fixtures
cover:

- Empty history
- Single payment
- Single event
- Mixed payments and events
- Cursor pagination across pages

## Migration notes

Existing clients using `GET /api/v1/wallet/:publicKey/history` should migrate
to `GET /api/v1/account/:publicKey/activity` to get Soroban contract events
included in the feed.

## Incoming-payment watching (#273)

Incoming-payment notifications no longer open one Horizon stream per watched
account. Instead a single ingestion loop reads each ledger once and fans out
matches to the notifier and SSE subscribers.

### Ledger-level ingestion

The watcher polls Horizon's global `/payments` stream (or RPC `getLedgers`)
from a persisted cursor, processing every ledger exactly once regardless of how
many accounts are watched. This keeps Horizon request volume flat as the user
base grows instead of scaling linearly with the number of accounts.

### Watched-account matching

Ingested payments are matched against the set of watched accounts using a bloom
filter for the fast negative path, backed by the database for authoritative
lookups. Accounts that are not watched are rejected by the filter without a DB
round-trip; filter hits are confirmed against the DB before fanout.

### Fanout

Matched payments are published to Redis channels consumed by the notifier and
SSE layers, so a single ingestion process can serve many API instances. Each
consumer only receives payments for accounts it is responsible for.

### Cursor persistence and catch-up

The ingestion cursor is persisted so that after a restart or downtime the
watcher resumes from the last processed ledger and catches up on any ledgers it
missed, rather than dropping notifications.

### Load testing

The watcher is load tested with 100k watched accounts to confirm notifications
are delivered within the latency budget while Horizon request volume stays
constant.
