import { Router } from "express";
import { Horizon } from "@stellar/stellar-sdk";
import { config } from "../config";
import { TtlCache } from "../services/ttlCache";
import { fromStroops } from "../utils/stroops";

/** Network base fee in stroops; Horizon never accepts less per operation. */
export const BASE_FEE_STROOPS = 100n;
const FEE_CACHE_TTL_MS = 5_000;

export interface FeeEstimate {
  stroops: string;
  xlm: string;
}

export interface NetworkFeesResponse {
  low: FeeEstimate;
  normal: FeeEstimate;
  high: FeeEstimate;
  ledgerCapacityUsage: string;
  source: "horizon" | "fallback";
}

/** The subset of Horizon's /fee_stats response this route reads. */
export interface FeeStatsLike {
  last_ledger_base_fee: string;
  ledger_capacity_usage: string;
  fee_charged: { p10: string; p50: string; p90: string };
}

export type FeeStatsFetcher = () => Promise<FeeStatsLike>;

function tier(stroops: bigint): FeeEstimate {
  const fee = stroops < BASE_FEE_STROOPS ? BASE_FEE_STROOPS : stroops;
  return { stroops: fee.toString(), xlm: fromStroops(fee) };
}

/** Turn Horizon fee stats into the low/normal/high tiers documented in #13. */
export function toNetworkFees(stats: FeeStatsLike): NetworkFeesResponse {
  return {
    low: tier(BigInt(stats.fee_charged.p10)),
    normal: tier(BigInt(stats.fee_charged.p50)),
    high: tier(BigInt(stats.fee_charged.p90)),
    ledgerCapacityUsage: stats.ledger_capacity_usage,
    source: "horizon",
  };
}

export const FALLBACK_FEES: NetworkFeesResponse = {
  low: tier(BASE_FEE_STROOPS),
  normal: tier(BASE_FEE_STROOPS),
  high: tier(BASE_FEE_STROOPS),
  ledgerCapacityUsage: "0",
  source: "fallback",
};

function horizonFeeStats(): FeeStatsFetcher {
  const server = new Horizon.Server(config.HORIZON_URL);
  return () => server.feeStats();
}

/**
 * GET /api/v1/network/fees (#13): p10/p50/p90 per-operation fees from
 * Horizon /fee_stats, cached for 5s. Falls back to the 100-stroop base fee
 * when Horizon is unreachable so the send flow can still build a
 * transaction.
 */
export function createNetworkRouter(fetchFeeStats: FeeStatsFetcher = horizonFeeStats()): Router {
  const router = Router();
  const cache = new TtlCache<NetworkFeesResponse>(FEE_CACHE_TTL_MS);

  router.get("/fees", async (_req, res) => {
    let fees = cache.get("fees");
    if (!fees) {
      try {
        fees = toNetworkFees(await fetchFeeStats());
        cache.set("fees", fees);
      } catch {
        // Not cached, so the next request retries Horizon.
        fees = FALLBACK_FEES;
      }
    }
    res.set("Cache-Control", "public, max-age=5");
    res.json(fees);
  });

  return router;
}
