/**
 * Ops alert channel shared by background jobs (#185 TTL keeper, #186
 * upgrade watcher). Every alert is logged as one structured JSON line; if
 * OPS_ALERT_WEBHOOK_URL is set it is also POSTed there. Delivery failures
 * are logged and swallowed — an alerting outage must never crash a worker.
 */
import { config } from "../config";

export type OpsAlertKind =
  | "ttl_near_expiry"
  | "ttl_extend_failed"
  | "ttl_restored"
  | "upgrade_proposed"
  | "upgrade_executed"
  | "channel_pool_exhausted"
  | "channel_topup_failed"
  | "channel_fee_bump_failed";

export interface OpsAlert {
  kind: OpsAlertKind;
  message: string;
  details?: Record<string, unknown>;
}

export type OpsAlertSink = (alert: OpsAlert) => Promise<void>;

export function createOpsAlertSink(
  webhookUrl: string | undefined = config.OPS_ALERT_WEBHOOK_URL,
  fetchImpl: typeof fetch = fetch
): OpsAlertSink {
  return async (alert) => {
    console.warn(JSON.stringify({ level: "alert", at: new Date().toISOString(), ...alert }));
    if (!webhookUrl) return;
    try {
      await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `[${alert.kind}] ${alert.message}`, ...alert }),
      });
    } catch (err) {
      console.error("[ops-alerts] webhook delivery failed", (err as Error).message);
    }
  };
}