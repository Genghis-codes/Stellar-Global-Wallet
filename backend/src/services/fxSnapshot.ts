import { Pool } from "pg";
import { config } from "../config";
import { FX_BASE_CURRENCY, type FiatCurrency, isSupportedCurrency } from "./fx";

/**
 * A daily FX rate snapshot for a single currency pair.
 */
export interface FxRateSnapshot {
  date: string;
  baseCurrency: FiatCurrency;
  quoteCurrency: string;
  rate: string;
  source: string;
  createdAt: string;
}

/**
 * Service for storing and retrieving daily FX rate snapshots.
 * Used for time-correct FX conversions (e.g., for tax reporting).
 */
export class FxSnapshotService {
  constructor(private readonly pool: Pool) {}

  /**
   * Store a daily FX rate snapshot.
   * Overwrites any existing snapshot for the same date and currency pair.
   */
  async upsertSnapshot(
    date: string,
    baseCurrency: FiatCurrency,
    quoteCurrency: string,
    rate: string,
    source: string
  ): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO fx_rate_snapshots (date, base_currency, quote_currency, rate, source)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (date, base_currency, quote_currency)
        DO UPDATE SET rate = $4, source = $5, updated_at = NOW()
      `,
      [date, baseCurrency, quoteCurrency, rate, source]
    );
  }

  /**
   * Get the FX rate for a specific date and currency pair.
   * Returns the closest available rate on or before the requested date.
   */
  async getRateOnDate(
    date: string | Date,
    baseCurrency: FiatCurrency,
    quoteCurrency: string
  ): Promise<FxRateSnapshot | null> {
    const dateStr = typeof date === "string" ? date : date.toISOString().slice(0, 10);

    const { rows } = await this.pool.query<FxRateSnapshot>(
      `
        SELECT date, base_currency, quote_currency, rate, source, created_at
        FROM fx_rate_snapshots
        WHERE date <= $1
          AND base_currency = $2
          AND quote_currency = $3
        ORDER BY date DESC
        LIMIT 1
      `,
      [dateStr, baseCurrency, quoteCurrency]
    );

    return rows[0] ?? null;
  }

  /**
   * Get all FX rate snapshots for a specific date.
   */
  async getSnapshotsForDate(date: string | Date): Promise<FxRateSnapshot[]> {
    const dateStr = typeof date === "string" ? date : date.toISOString().slice(0, 10);

    const { rows } = await this.pool.query<FxRateSnapshot>(
      `
        SELECT date, base_currency, quote_currency, rate, source, created_at
        FROM fx_rate_snapshots
        WHERE date = $1
        ORDER BY base_currency, quote_currency
      `,
      [dateStr]
    );

    return rows;
  }

  /**
   * Get the most recent snapshot date available.
   */
  async getLatestSnapshotDate(): Promise<string | null> {
    const { rows } = await this.pool.query<{ date: string }>(
      `SELECT date FROM fx_rate_snapshots ORDER BY date DESC LIMIT 1`
    );
    return rows[0]?.date ?? null;
  }

  /**
   * Get the earliest snapshot date available.
   */
  async getEarliestSnapshotDate(): Promise<string | null> {
    const { rows } = await this.pool.query<{ date: string }>(
      `SELECT date FROM fx_rate_snapshots ORDER BY date ASC LIMIT 1`
    );
    return rows[0]?.date ?? null;
  }

  /**
   * Delete all snapshots from a given date forward (for re-importing).
   */
  async deleteFrom(date: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM fx_rate_snapshots WHERE date >= $1`,
      [date]
    );
  }

  /**
   * Backfill historical snapshots using the current FX service.
   * Goes back `days` days from `endDate` (default: today).
   */
  async backfillHistorical(
    days: number,
    endDate: Date = new Date(),
    fxService: {
      getQuote: (currency: FiatCurrency) => Promise<{ rate: string; source: string }>;
    }
  ): Promise<number> {
    let count = 0;

    for (let i = 0; i < days; i++) {
      const snapshotDate = new Date(endDate);
      snapshotDate.setDate(snapshotDate.getDate() - i);
      const dateStr = snapshotDate.toISOString().slice(0, 10);

      // Skip if we already have this date
      const existing = await this.getSnapshotsForDate(snapshotDate);
      if (existing.length > 0) {
        console.log(`[fx-snapshot] Skipping ${dateStr}: ${existing.length} snapshots exist`);
        continue;
      }

      // Fetch rates for all supported currencies
      for (const quote of config.FX_SNAPSHOT_CURRENCIES.split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => isSupportedCurrency(s as FiatCurrency) && s !== FX_BASE_CURRENCY)) {
        try {
          const { rate, source } = await fxService.getQuote(quote as FiatCurrency);
          await this.upsertSnapshot(dateStr, FX_BASE_CURRENCY, quote, rate, source);
          count++;
        } catch (err) {
          console.warn(`[fx-snapshot] Failed to fetch ${quote} for ${dateStr}: ${err}`);
        }
      }

      // Small delay to avoid rate limiting
      if (i < days - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return count;
  }
}
