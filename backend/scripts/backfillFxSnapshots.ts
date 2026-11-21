#!/usr/bin/env tsx
/**
 * Backfill FX rate snapshots for historical conversions.
 *
 * Usage: npm run backfill:fx -- [days] [endDate]
 *   days: Number of days to backfill (default: 30)
 *   endDate: End date in YYYY-MM-DD format (default: today)
 *
 * Example:
 *   npx tsx scripts/backfillFxSnapshots.ts 365 2025-01-01
 */

import { Pool } from "pg";
import { config } from "../src/config";
import { FxService, type FiatCurrency } from "../src/services/fx";
import { FxSnapshotService } from "../src/services/fxSnapshot";
import { FX_BASE_CURRENCY } from "../src/services/fx";

async function main() {
  const days = parseInt(process.argv[2] ?? "30", 10);
  const endDateStr = process.argv[3] ?? new Date().toISOString().slice(0, 10);

  const endDate = new Date(endDateStr + "T00:00:00Z");

  console.log(`[backfill] Backfilling ${days} days of FX snapshots`);
  console.log(`[backfill] End date: ${endDate.toISOString().slice(0, 10)}`);
  console.log(`[backfill] Snapshot currencies: ${config.FX_SNAPSHOT_CURRENCIES}`);

  const pool = new Pool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
  });

  // Create snapshot service
  const snapshotService = new FxSnapshotService(pool);
  const fxService = new FxService(pool);

  // Check existing range
  const latest = await snapshotService.getLatestSnapshotDate();
  const earliest = await snapshotService.getEarliestSnapshotDate();

  if (latest) {
    console.log(`[backfill] Latest existing snapshot: ${latest}`);
  }
  if (earliest) {
    console.log(`[backfill] Earliest existing snapshot: ${earliest}`);
  }

  // Determine start date (go back from end date)
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);

  console.log(`[backfill] Backfilling from ${startDate.toISOString().slice(0, 10)} to ${endDateStr}`);

  // Backfill
  const snapshotCurrencies = config.FX_SNAPSHOT_CURRENCIES.split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s !== FX_BASE_CURRENCY && /^[A-Z]{3}$/.test(s)) as FiatCurrency[];

  if (snapshotCurrencies.length === 0) {
    console.warn("[backfill] No valid snapshot currencies configured");
    process.exit(0);
  }

  console.log(`[backfill] Processing ${snapshotCurrencies.length} currency pairs`);

  let totalSnaps = 0;
  let totalUpserts = 0;

  for (let d = 0; d < days; d++) {
    const snapshotDate = new Date(startDate);
    snapshotDate.setDate(snapshotDate.getDate() + d);
    const dateStr = snapshotDate.toISOString().slice(0, 10);

    // Skip if already exists
    const existing = await snapshotService.getSnapshotsForDate(snapshotDate);
    if (existing.length > 0) {
      console.log(`[backfill] Skipping ${dateStr}: ${existing.length} snapshots exist`);
      totalSnaps += existing.length;
      continue;
    }

    console.log(`[backfill] Backfilling ${dateStr}...`);

    for (const quote of snapshotCurrencies) {
      try {
        const { rate, source } = await fxService.getQuote(quote);
        await snapshotService.upsertSnapshot(dateStr, FX_BASE_CURRENCY, quote, rate, source);
        totalUpserts++;
        console.log(`  [backfill] ${dateStr} ${FX_BASE_CURRENCY}/${quote} = ${rate}`);
      } catch (err) {
        console.warn(`[backfill] Failed for ${dateStr} ${quote}: ${err}`);
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    totalSnaps += snapshotCurrencies.length;
  }

  console.log(`[backfill] Complete!`);
  console.log(`[backfill] Total snapshots created: ${totalUpserts}`);
  console.log(`[backfill] Total snapshot records: ${totalSnaps}`);

  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill] Fatal error:", err);
  process.exit(1);
});
